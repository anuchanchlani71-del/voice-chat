const Interest = require('../models/Interest');

/**
 * Controller: GET /api/v1/admin/interests
 * Retrieve paginated interest tags catalog with category filtering and search.
 */
async function getInterests(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const { search, category, isActive, status } = req.query || {};

    const filter = {};

    // 1. Search by name or category
    if (search && typeof search === 'string' && search.trim()) {
      const term = search.trim();
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [
        { name: regex },
        { category: regex }
      ];
    }

    // 2. Category filter
    if (category && typeof category === 'string' && category !== 'all') {
      filter.category = category.trim();
    }

    // 3. Active status filter
    const activeParam = (isActive !== undefined ? isActive : status);
    if (activeParam && activeParam !== 'all') {
      const norm = String(activeParam).toLowerCase();
      if (norm === 'true' || norm === 'active') {
        filter.isActive = true;
      } else if (norm === 'false' || norm === 'inactive') {
        filter.isActive = false;
      }
    }

    // Parallel fetch: Interests, Total Count, and Unique Category list
    const [rawInterests, totalItems, categories] = await Promise.all([
      Interest.find(filter)
        .sort({ userCount: -1, name: 1 })
        .skip(skip)
        .limit(limit),
      Interest.countDocuments(filter),
      Interest.distinct('category')
    ]);

    const interests = rawInterests.map((item) => Interest.sanitize(item));
    const totalPages = Math.ceil(totalItems / limit) || 1;

    return res.status(200).json({
      success: true,
      interests,
      categories: categories.sort(),
      pagination: {
        currentPage: page,
        pageSize: limit,
        totalItems,
        totalPages
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: POST /api/v1/admin/interests
 * Create a new interest tag in the platform catalog.
 */
async function createInterest(req, res, next) {
  try {
    const { name, category, icon, isActive } = req.body || {};

    // 1. Validate required name
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Interest tag name is required and cannot be empty.'
      });
    }

    const trimmedName = name.trim();

    // 2. Prevent duplicate interest names (case-insensitive)
    const existing = await Interest.findByName(trimmedName);
    if (existing) {
      return res.status(400).json({
        success: false,
        error: `An interest tag named "${trimmedName}" already exists.`
      });
    }

    // 3. Create and persist interest
    const newInterest = new Interest({
      name: trimmedName,
      category: category && typeof category === 'string' && category.trim() ? category.trim() : 'Entertainment & Arts',
      icon: icon && typeof icon === 'string' && icon.trim() ? icon.trim() : '✨',
      isActive: isActive !== undefined ? Boolean(isActive) : true,
      userCount: 0
    });

    await newInterest.save();

    return res.status(201).json({
      success: true,
      message: 'Interest tag created successfully',
      interest: Interest.sanitize(newInterest)
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'An interest tag with this name already exists.'
      });
    }
    next(err);
  }
}

/**
 * Controller: PUT /api/v1/admin/interests/:id
 * Update an existing interest tag metadata. Requires a non-empty body with at least one supported field.
 */
async function updateInterest(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Interest ID parameter is required.'
      });
    }

    // 1. Reject empty or non-object body
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one field is required to update the interest.'
      });
    }

    const { name, category, icon, isActive } = body;

    // 2. Validate empty string inputs
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Interest tag name cannot be empty.'
      });
    }

    if (category !== undefined && (typeof category !== 'string' || !category.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Category cannot be empty.'
      });
    }

    if (icon !== undefined && (typeof icon !== 'string' || !icon.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Icon cannot be empty.'
      });
    }

    // 3. Check for at least one supported field
    const hasValidName = name !== undefined && typeof name === 'string' && name.trim().length > 0;
    const hasValidCategory = category !== undefined && typeof category === 'string' && category.trim().length > 0;
    const hasValidIcon = icon !== undefined && typeof icon === 'string' && icon.trim().length > 0;
    const hasValidIsActive = isActive !== undefined && typeof isActive === 'boolean';

    if (!hasValidName && !hasValidCategory && !hasValidIcon && !hasValidIsActive) {
      return res.status(400).json({
        success: false,
        error: 'At least one field is required to update the interest.'
      });
    }

    // 4. Find document in database
    const interest = await Interest.findInterestByIdOrMongoId(id);
    if (!interest) {
      return res.status(404).json({
        success: false,
        error: `Interest tag not found with ID "${id}".`
      });
    }

    // 5. If name is modified, check for duplicate collision
    if (hasValidName) {
      const trimmedName = name.trim();
      if (trimmedName.toLowerCase() !== interest.name.toLowerCase()) {
        const existingWithName = await Interest.findByName(trimmedName);
        if (existingWithName && existingWithName._id.toString() !== interest._id.toString()) {
          return res.status(400).json({
            success: false,
            error: `Another interest tag named "${trimmedName}" already exists.`
          });
        }
      }
      interest.name = trimmedName;
    }

    if (hasValidCategory) {
      interest.category = category.trim();
    }

    if (hasValidIcon) {
      interest.icon = icon.trim();
    }

    if (hasValidIsActive) {
      interest.isActive = isActive;
    }

    await interest.save();

    return res.status(200).json({
      success: true,
      message: 'Interest tag updated successfully',
      interest: Interest.sanitize(interest)
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'An interest tag with this name already exists.'
      });
    }
    next(err);
  }
}

/**
 * Controller: DELETE /api/v1/admin/interests/:id
 * Delete an interest tag from the platform catalog.
 */
async function deleteInterest(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Interest ID parameter is required.'
      });
    }

    const interest = await Interest.findInterestByIdOrMongoId(id);
    if (!interest) {
      return res.status(404).json({
        success: false,
        error: `Interest tag not found with ID "${id}".`
      });
    }

    const deletedName = interest.name;
    await Interest.deleteOne({ _id: interest._id });

    return res.status(200).json({
      success: true,
      message: `Interest tag "#${deletedName}" deleted successfully from catalog.`
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getInterests,
  createInterest,
  updateInterest,
  deleteInterest
};
