import mongoose from 'mongoose';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/auth';
import { Device } from '../models/Device';
import { User } from '../models/User';
import { ApiError, asyncHandler, clamp, parseIntParam } from '../utils/http';

const DEFAULT_PAGE_LIMIT = 50;

const router = Router();

// All admin routes require authentication + admin role.
router.use(requireAuth);
router.use(requireAdmin);

/**
 * GET /api/admin/devices — list all devices with owner info populated.
 * Query: ?page=&limit= (default limit 50)
 * Returns deviceId, name, status, ownerId, owner { name, email }.
 */
router.get(
  '/devices',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseIntParam(req.query.page, 1));
    const limit = clamp(parseIntParam(req.query.limit, DEFAULT_PAGE_LIMIT), 1, DEFAULT_PAGE_LIMIT);

    const [total, docs] = await Promise.all([
      Device.countDocuments({}),
      Device.find({})
        .sort({ deviceId: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('ownerId', 'name email')
        .lean()
    ]);

    const data = docs.map((d) => {
      // `.populate('ownerId')` replaces ownerId with the User doc, so the raw
      // ObjectId string is recovered from the populated doc's `_id`.
      const populated = d.ownerId as any;
      const rawOwnerId = populated ? String(populated._id ?? d.ownerId) : null;
      return {
        deviceId: d.deviceId,
        name: d.name,
        status: d.status,
        ownerId: rawOwnerId,
        owner: populated
          ? { name: populated.name, email: populated.email }
          : null,
      };
    });

    res.json({
      success: true,
      data,
      pagination: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  })
);

/**
 * GET /api/admin/users — list all users (no passwordHash).
 * Query: ?page=&limit= (default limit 50)
 * Returns _id, name, email, role, emailVerified.
 */
router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseIntParam(req.query.page, 1));
    const limit = clamp(parseIntParam(req.query.limit, DEFAULT_PAGE_LIMIT), 1, DEFAULT_PAGE_LIMIT);

    const [total, docs] = await Promise.all([
      User.countDocuments({}),
      User.find({})
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('_id name email role emailVerified createdAt')
        .lean()
    ]);

    res.json({
      success: true,
      data: docs,
      pagination: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  })
);

/**
 * PATCH /api/admin/devices/:id/owner
 * Transfer ownership of a device to another user.
 * Body: { ownerId: string } — must be a valid 24-hex-char ObjectId of an existing User.
 */
router.patch(
  '/devices/:id/owner',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { ownerId } = req.body as { ownerId?: string };

    if (!ownerId || !/^[0-9a-fA-F]{24}$/.test(ownerId)) {
      throw new ApiError(400, 'ownerId must be a valid 24-character hex ObjectId');
    }

    const targetUser = await User.findById(ownerId).lean();
    if (!targetUser) {
      throw new ApiError(404, 'Target user not found');
    }

    let device;
    if (/^[0-9a-fA-F]{24}$/.test(id)) {
      device = await Device.findById(id).lean();
    } else {
      device = await Device.findOne({ deviceId: id }).lean();
    }

    if (!device) {
      throw new ApiError(404, 'Device not found');
    }

    const updated = await Device.findByIdAndUpdate(
      device._id,
      { $set: { ownerId: new mongoose.Types.ObjectId(ownerId) } },
      { new: true }
    ).lean();

    res.json({ success: true, data: { device: updated } });
  })
);

export default router;