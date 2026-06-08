'use strict';
const pool = require('../config/db');

// POST /marketplace/chats/get-or-create
exports.getOrCreateChat = async (req, res, next) => {
  try {
    const { listing_id, seller_id } = req.body;
    const buyer_id = req.user.id;

    if (!listing_id || !seller_id)
      return res.status(400).json({ success: false, message: 'listing_id and seller_id required' });
    if (buyer_id === seller_id)
      return res.status(400).json({ success: false, message: 'Cannot chat with yourself' });

    // Find or create chat
    let chat = await pool.query(
      `SELECT * FROM public.marketplace_chats
       WHERE listing_id=$1 AND buyer_id=$2 AND seller_id=$3`,
      [listing_id, buyer_id, seller_id]
    );

    if (!chat.rows.length) {
      chat = await pool.query(
        `INSERT INTO public.marketplace_chats (listing_id, buyer_id, seller_id)
         VALUES ($1,$2,$3) RETURNING *`,
        [listing_id, buyer_id, seller_id]
      );
    }

    const chatRow = chat.rows[0];

    // Get messages with sender info
    const msgs = await pool.query(
      `SELECT cm.*, u.name AS sender_name, u.avatar_url AS sender_avatar
       FROM public.marketplace_chat_messages cm
       JOIN public.users u ON u.id = cm.sender_id
       WHERE cm.chat_id=$1
       ORDER BY cm.sent_at ASC`,
      [chatRow.id]
    );

    // Mark messages as read for buyer
    await pool.query(
      `UPDATE public.marketplace_chat_messages
       SET is_read=TRUE
       WHERE chat_id=$1 AND sender_id<>$2`,
      [chatRow.id, buyer_id]
    );

    res.json({ success: true, chat: chatRow, messages: msgs.rows });
  } catch (err) { next(err); }
};

// GET /marketplace/chats/:chatId/messages
exports.getMessages = async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;

    // Verify user is part of this chat
    const chat = await pool.query(
      'SELECT * FROM public.marketplace_chats WHERE id=$1 AND (buyer_id=$2 OR seller_id=$2)',
      [chatId, userId]
    );
    if (!chat.rows.length)
      return res.status(403).json({ success: false, message: 'Not authorised' });

    const msgs = await pool.query(
      `SELECT cm.*, u.name AS sender_name, u.avatar_url AS sender_avatar
       FROM public.marketplace_chat_messages cm
       JOIN public.users u ON u.id = cm.sender_id
       WHERE cm.chat_id=$1
       ORDER BY cm.sent_at ASC`,
      [chatId]
    );

    // Mark as read
    await pool.query(
      `UPDATE public.marketplace_chat_messages
       SET is_read=TRUE
       WHERE chat_id=$1 AND sender_id<>$2 AND is_read=FALSE`,
      [chatId, userId]
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

    // Verify user is part of chat
    const chat = await pool.query(
      'SELECT * FROM public.marketplace_chats WHERE id=$1 AND (buyer_id=$2 OR seller_id=$2)',
      [chatId, sender_id]
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
      [chatId, sender_id, type, text || null, offer_amount ? Number(offer_amount) : null]
    );

    // Update chat last_msg_at
    await pool.query(
      `UPDATE public.marketplace_chats
       SET last_message=$1, last_msg_at=NOW(), updated_at=NOW()
       WHERE id=$2`,
      [text || `Offer: ₹${offer_amount}`, chatId]
    );

    // Enrich with sender info
    const enriched = await pool.query(
      `SELECT cm.*, u.name AS sender_name, u.avatar_url AS sender_avatar
       FROM public.marketplace_chat_messages cm
       JOIN public.users u ON u.id=cm.sender_id
       WHERE cm.id=$1`,
      [msg.rows[0].id]
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
      [userId]
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
      [chatId, req.user.id]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
};
