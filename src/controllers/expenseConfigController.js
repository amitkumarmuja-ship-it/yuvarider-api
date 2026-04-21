/**
 * expenseConfigController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Returns dynamic expense categories and payment methods with full icon/color
 * config for the mobile app. Data is served from config (no DB table needed)
 * but structured to be easily migrated to a DB table in future.
 */
'use strict';

/**
 * GET /api/v1/expense-config
 * Returns all categories and payment methods with their icon/color metadata.
 *
 * Response:
 * {
 *   success: true,
 *   categories: [
 *     { key, label, emoji, color, bg, order, active }
 *   ],
 *   payment_methods: [
 *     { key, label, emoji, icon, active }
 *   ]
 * }
 */
exports.getExpenseConfig = async (req, res, next) => {
  try {
    const categories = [
      {
        key:    'Fuel',
        label:  'Fuel',
        emoji:  '⛽',
        color:  '#FFFFFF',
        bg:     '#22c55e',
        order:  1,
        active: true,
      },
      {
        key:    'Food',
        label:  'Food & Drinks',
        emoji:  '🍔',
        color:  '#FFFFFF',
        bg:     '#f97316',
        order:  2,
        active: true,
      },
      {
        key:    'Maintenance',
        label:  'Maintenance',
        emoji:  '🔧',
        color:  '#FFFFFF',
        bg:     '#64748b',
        order:  3,
        active: true,
      },
      {
        key:    'Toll',
        label:  'Toll Fees',
        emoji:  '🛣️',
        color:  '#FFFFFF',
        bg:     '#eab308',
        order:  4,
        active: true,
      },
      {
        key:    'Parking',
        label:  'Parking',
        emoji:  '🅿️',
        color:  '#FFFFFF',
        bg:     '#3b82f6',
        order:  5,
        active: true,
      },
      {
        key:    'Other',
        label:  'Other',
        emoji:  '📝',
        color:  '#FFFFFF',
        bg:     '#8b5cf6',
        order:  6,
        active: true,
      },
      {
        key:    'Mechanic',
        label:  'Mechanic',
        emoji:  '🔩',
        color:  '#FFFFFF',
        bg:     '#ef4444',
        order:  7,
        active: true,
      },
      {
        key:    'Gear',
        label:  'Gear',
        emoji:  '🪖',
        color:  '#FFFFFF',
        bg:     '#8b5cf6',
        order:  8,
        active: true,
      },
    ];

    const payment_methods = [
      {
        key:    'cash',
        label:  'Cash',
        emoji:  '💵',
        icon:   'banknotes',
        active: true,
      },
      {
        key:    'upi',
        label:  'UPI',
        emoji:  '📱',
        icon:   'smartphone',
        active: true,
      },
      {
        key:    'card',
        label:  'Card',
        emoji:  '💳',
        icon:   'credit-card',
        active: true,
      },
      {
        key:    'wallet',
        label:  'Wallet',
        emoji:  '👛',
        icon:   'wallet',
        active: true,
      },
    ];

    res.json({
      success:         true,
      categories:      categories.filter(c => c.active).sort((a, b) => a.order - b.order),
      payment_methods: payment_methods.filter(p => p.active),
    });
  } catch (err) {
    next(err);
  }
};
