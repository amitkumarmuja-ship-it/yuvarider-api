'use strict';
const pool = require('../config/db');

// POST /marketplace/chats/get-or-create
//
// FIX v2: When a buyer starts a chat for the first time, we also upsert a
// marketplace_purchase_request row (status = 'pending').  This makes the item
// show up in the buyer's "Buy" tab in DealsScreen (which queries
// marketplace_purchase_requests) WITH the Chat button visible.
//
// Logic:
//  • If the chat already existed  → do NOT touch the purchase request (keeps
//    accepted / rejected status as-is)
//  • If the chat is brand-new     → INSERT or re-activate a purchase request
//    so DealsScreen can surface it immediately
//
exports.getOrCreateChat = async (req, res, next) => {
  try {
    const { listing_id, seller_id } = req.body;
    const buyer_id = req.user.id;

    if (!listing_id || !seller_id)
      return res.status(400).json({ success: false, message: 'listing_id and seller_id required' });
    if (buyer_id === seller_id)
      return res.status(400).json({ success: false, message: 'Cannot chat with yourself' });

    // ── 1. Find or create the chat row ─────────────────────────────────────
    let existingChat = await pool.query(
      `SELECT * FROM public.marketplace_chats
       WHERE listing_id=$1 AND buyer_id=$2 AND seller_id=$3`,
      [listing_id, buyer_id, seller_id],
    );

    const isNewChat = existingChat.rows.length === 0;
    let chatRow;

    if (isNewChat) {
      const inserted = await pool.query(
        `INSERT INTO public.marketplace_chats (listing_id, buyer_id, seller_id)
         VALUES ($1,$2,$3) RETURNING *`,
        [listing_id, buyer_id, seller_id],
      );
      chatRow = inserted.rows[0];
    } else {
      chatRow = existingChat.rows[0];
    }

    // ── 2. Auto-upsert purchase request so Buy tab shows this item ──────────
    //    Only touch the request when:
    //      a) this is a brand-new chat  (first contact), OR
    //      b) the listing is active AND no non-rejected request exists yet
    if (isNewChat) {
      // Check if a request already exists (could have been manually submitted before)
      const existingReq = await pool.query(
        `SELECT id, status FROM public.marketplace_purchase_requests
         WHERE listing_id=$1 AND buyer_id=$2`,
        [listing_id, buyer_id],
      );

      if (existingReq.rows.length === 0) {
        // Insert a fresh pending request — this is what DealsScreen Buy tab reads
        await pool.query(
          `INSERT INTO public.marketplace_purchase_requests
             (listing_id, buyer_id, message)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [listing_id, buyer_id, 'Interested — started chat'],
        );
      } else if (existingReq.rows[0].status === 'rejected') {
        // Buyer had withdrawn / been rejected, now started chatting again → re-activate
        await pool.query(
          `UPDATE public.marketplace_purchase_requests
           SET status='pending', updated_at=NOW()
           WHERE id=$1`,
          [existingReq.rows[0].id],
        );
      }
      // If status is already 'pending' or 'accepted', leave it alone
    }

    // ── 3. Load messages ──────────────────────────────────────────────────
    const msgs = await pool.query(
      `SELECT cm.*, u.name AS sender_name, u.avatar_url AS sender_avatar
       FROM public.marketplace_chat_messages cm
       JOIN public.users u ON u.id = cm.sender_id
       WHERE cm.chat_id=$1
       ORDER BY cm.sent_at ASC`,
      [chatRow.id],
    );

    // ── 4. Mark messages as read for buyer ────────────────────────────────
    await pool.query(
      `UPDATE public.marketplace_chat_messages
       SET is_read=TRUE
       WHERE chat_id=$1 AND sender_id<>$2`,
      [chatRow.id, buyer_id],
    );

    res.json({ success: true, chat: chatRow, messages: msgs.rows });
  } catch (err) { next(err); }
};

// GET /marketplace/chats/:chatId/messages
exports.getMessages = async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;

    const chat = await pool.query(
      'SELECT * FROM public.marketplace_chats WHERE id=$1 AND (buyer_id=$2 OR seller_id=$2)',
      [chatId, userId],
    );
    if (!chat.rows.length)
      return res.status(403).json({ success: false, message: 'Not authorised' });

    const msgs = await pool.query(
      `SELECT cm.*, u.name AS sender_name, u.avatar_url AS sender_avatar
       FROM public.marketplace_chat_messages cm
       JOIN public.users u ON u.id = cm.sender_id
       WHERE cm.chat_id=$1
       ORDER BY cm.sent_at ASC`,
      [chatId],
    );

    await pool.query(
      `UPDATE public.marketplace_chat_messages
       SET is_read=TRUE
       WHERE chat_id=$1 AND sender_id<>$2 AND is_read=FALSE`,
      [chatId, userId],
    );

    res.json({ success: true, messages: msgs.rows });
  } catch (err) { next(err); }
};

// POST /marketplace/chats/:chatId/messages
exports.sendMessage = async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const { type = 'text', text, offer_amount } = req.body;
    const sender_id = req.user.id;

    const chat = await pool.query(
      'SELECT * FROM public.marketplace_chats WHERE id=$1 AND (buyer_id=$2 OR seller_id=$2)',
      [chatId, sender_id],
    );
    if (!chat.rows.length)
      return res.status(403).json({ success: false, message: 'Not authorised' });

    if (!text && type !== 'offer')
      return res.status(400).json({ success: false, message: 'text is required' });
    if (type === 'offer' && (!offer_amount || isNaN(Number(offer_amount))))
      return res.status(400).json({ success: false, message: 'offer_amount required for offer type' });

    const msg = await pool.query(
      `INSERT INTO public.marketplace_chat_messages
         (chat_id, sender_id, type, text, offer_amount)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [chatId, sender_id, type, text || null, offer_amount ? Number(offer_amount) : null],
    );

    await pool.query(
      `UPDATE public.marketplace_chats
       SET last_message=$1, last_msg_at=NOW(), updated_at=NOW()
       WHERE id=$2`,
      [text || `Offer: ₹${offer_amount}`, chatId],
    );

    const enriched = await pool.query(
      `SELECT cm.*, u.name AS sender_name, u.avatar_url AS sender_avatar
       FROM public.marketplace_chat_messages cm
       JOIN public.users u ON u.id=cm.sender_id
       WHERE cm.id=$1`,
      [msg.rows[0].id],
    );

    res.json({ success: true, message: enriched.rows[0] });
  } catch (err) { next(err); }
};

// GET /marketplace/chats  — list all chats for current user
exports.getMyChats = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const r = await pool.query(
      `SELECT mc.*,
              ml.title   AS listing_title,
              ml.price   AS listing_price,
              (ml.image_urls)[1] AS listing_image,
              CASE WHEN mc.buyer_id=$1 THEN su.name  ELSE bu.name  END AS other_user_name,
              CASE WHEN mc.buyer_id=$1 THEN su.avatar_url ELSE bu.avatar_url END AS other_user_avatar,
              COALESCE(unread.cnt,0)::int AS unread_count
       FROM public.marketplace_chats mc
       JOIN public.marketplace_listings ml ON ml.id = mc.listing_id
       JOIN public.users bu ON bu.id = mc.buyer_id
       JOIN public.users su ON su.id = mc.seller_id
       LEFT JOIN (
         SELECT chat_id, COUNT(*) AS cnt
         FROM public.marketplace_chat_messages
         WHERE sender_id<>$1 AND is_read=FALSE
         GROUP BY chat_id
       ) unread ON unread.chat_id = mc.id
       WHERE mc.buyer_id=$1 OR mc.seller_id=$1
       ORDER BY mc.last_msg_at DESC NULLS LAST, mc.created_at DESC`,
      [userId],
    );
    res.json({ success: true, chats: r.rows });
  } catch (err) { next(err); }
};

// PUT /marketplace/chats/:chatId/read
exports.markRead = async (req, res, next) => {
  try {
    const { chatId } = req.params;
    await pool.query(
      `UPDATE public.marketplace_chat_messages
       SET is_read=TRUE
       WHERE chat_id=$1 AND sender_id<>$2`,
      [chatId, req.user.id],
    );
    res.json({ success: true });
  } catch (err) { next(err); }
};
