const IcebreakerPrompt = require('../models/IcebreakerPrompt');

/**
 * Controller: GET /api/v1/admin/icebreaker-prompts
 * Retrieve paginated icebreaker prompts with search, interest filter, and status filter.
 */
async function listIcebreakerPrompts(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const { search, interest, status } = req.query || {};

    const filter = {};

    // 1. Search Filter (prompt text or interest name)
    if (search && typeof search === 'string' && search.trim()) {
      const term = search.trim();
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [
        { prompt: regex },
        { interest: regex }
      ];
    }

    // 2. Interest Filter
    if (interest && typeof interest === 'string' && interest.trim()) {
      const trimmedInterest = interest.trim();
      if (trimmedInterest.toLowerCase() !== 'all' && trimmedInterest.toLowerCase() !== 'all interests') {
        const escapedInterest = trimmedInterest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.interest = new RegExp(`^${escapedInterest}$`, 'i');
      }
    }

    // 3. Status Filter (active, inactive)
    if (status && typeof status === 'string' && status.trim()) {
      const normStatus = status.toLowerCase().trim();
      if (normStatus !== 'all' && normStatus !== 'all status' && ['active', 'inactive'].includes(normStatus)) {
        filter.status = normStatus;
      }
    }

    // Parallel fetch: records and count
    const [rawPrompts, totalItems] = await Promise.all([
      IcebreakerPrompt.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      IcebreakerPrompt.countDocuments(filter)
    ]);

    const prompts = rawPrompts.map((p) => IcebreakerPrompt.sanitize(p));
    const totalPages = Math.ceil(totalItems / limit) || 1;

    return res.status(200).json({
      success: true,
      data: prompts,
      prompts,
      pagination: {
        page,
        limit,
        total: totalItems,
        totalPages,
        currentPage: page,
        pageSize: limit,
        totalItems
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: GET /api/v1/admin/icebreaker-prompts/:id
 * Retrieve a single icebreaker prompt by ID.
 */
async function getIcebreakerPrompt(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Icebreaker prompt ID parameter is required.'
      });
    }

    const promptDoc = await IcebreakerPrompt.findPromptByIdOrMongoId(id);
    if (!promptDoc) {
      return res.status(404).json({
        success: false,
        error: `Icebreaker prompt not found with ID "${id}".`
      });
    }

    const sanitized = IcebreakerPrompt.sanitize(promptDoc);
    return res.status(200).json({
      success: true,
      data: sanitized,
      prompt: sanitized
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: POST /api/v1/admin/icebreaker-prompts
 * Create a new icebreaker prompt.
 */
async function createIcebreakerPrompt(req, res, next) {
  try {
    const { interest, prompt, status } = req.body || {};

    // 1. Validate interest
    if (!interest || typeof interest !== 'string' || !interest.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Interest is required and cannot be empty.'
      });
    }

    // 2. Validate prompt
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Prompt text is required and cannot be empty.'
      });
    }

    // 3. Validate status if provided
    let normStatus = 'active';
    if (status !== undefined) {
      if (typeof status !== 'string' || !['active', 'inactive'].includes(status.toLowerCase().trim())) {
        return res.status(400).json({
          success: false,
          error: 'Status must be either "active" or "inactive".'
        });
      }
      normStatus = status.toLowerCase().trim();
    }

    const newPrompt = new IcebreakerPrompt({
      interest: interest.trim(),
      prompt: prompt.trim(),
      status: normStatus
    });

    await newPrompt.save();
    const sanitized = IcebreakerPrompt.sanitize(newPrompt);

    return res.status(201).json({
      success: true,
      message: 'Icebreaker prompt created successfully',
      data: sanitized,
      prompt: sanitized
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: PUT /api/v1/admin/icebreaker-prompts/:id
 * Update an existing icebreaker prompt.
 */
async function updateIcebreakerPrompt(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Icebreaker prompt ID parameter is required.'
      });
    }

    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Request body cannot be empty.'
      });
    }

    const { interest, prompt, status } = body;

    // Validate fields if provided
    if (interest !== undefined && (typeof interest !== 'string' || !interest.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Interest cannot be empty.'
      });
    }

    if (prompt !== undefined && (typeof prompt !== 'string' || !prompt.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Prompt text cannot be empty.'
      });
    }

    if (status !== undefined && (typeof status !== 'string' || !['active', 'inactive'].includes(status.toLowerCase().trim()))) {
      return res.status(400).json({
        success: false,
        error: 'Status must be either "active" or "inactive".'
      });
    }

    const hasValidInterest = interest !== undefined && typeof interest === 'string' && interest.trim().length > 0;
    const hasValidPrompt = prompt !== undefined && typeof prompt === 'string' && prompt.trim().length > 0;
    const hasValidStatus = status !== undefined && typeof status === 'string' && ['active', 'inactive'].includes(status.toLowerCase().trim());

    if (!hasValidInterest && !hasValidPrompt && !hasValidStatus) {
      return res.status(400).json({
        success: false,
        error: 'At least one valid field (interest, prompt, status) is required to update the icebreaker prompt.'
      });
    }

    const promptDoc = await IcebreakerPrompt.findPromptByIdOrMongoId(id);
    if (!promptDoc) {
      return res.status(404).json({
        success: false,
        error: `Icebreaker prompt not found with ID "${id}".`
      });
    }

    if (hasValidInterest) {
      promptDoc.interest = interest.trim();
    }
    if (hasValidPrompt) {
      promptDoc.prompt = prompt.trim();
    }
    if (hasValidStatus) {
      promptDoc.status = status.toLowerCase().trim();
    }

    await promptDoc.save();
    const sanitized = IcebreakerPrompt.sanitize(promptDoc);

    return res.status(200).json({
      success: true,
      message: 'Icebreaker prompt updated successfully',
      data: sanitized,
      prompt: sanitized
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: PATCH /api/v1/admin/icebreaker-prompts/:id/status
 * Update the status of an icebreaker prompt (active / inactive).
 */
async function updateIcebreakerPromptStatus(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Icebreaker prompt ID parameter is required.'
      });
    }

    const { status } = req.body || {};

    if (!status || typeof status !== 'string' || !['active', 'inactive'].includes(status.toLowerCase().trim())) {
      return res.status(400).json({
        success: false,
        error: 'Status is required and must be either "active" or "inactive".'
      });
    }

    const promptDoc = await IcebreakerPrompt.findPromptByIdOrMongoId(id);
    if (!promptDoc) {
      return res.status(404).json({
        success: false,
        error: `Icebreaker prompt not found with ID "${id}".`
      });
    }

    promptDoc.status = status.toLowerCase().trim();
    await promptDoc.save();
    const sanitized = IcebreakerPrompt.sanitize(promptDoc);

    return res.status(200).json({
      success: true,
      message: 'Icebreaker prompt status updated successfully',
      data: sanitized,
      prompt: sanitized
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: DELETE /api/v1/admin/icebreaker-prompts/:id
 * Delete an icebreaker prompt from the database.
 */
async function deleteIcebreakerPrompt(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Icebreaker prompt ID parameter is required.'
      });
    }

    const promptDoc = await IcebreakerPrompt.findPromptByIdOrMongoId(id);
    if (!promptDoc) {
      return res.status(404).json({
        success: false,
        error: `Icebreaker prompt not found with ID "${id}".`
      });
    }

    await IcebreakerPrompt.deleteOne({ _id: promptDoc._id });

    return res.status(200).json({
      success: true,
      message: 'Icebreaker prompt deleted successfully'
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listIcebreakerPrompts,
  getIcebreakerPrompts: listIcebreakerPrompts,
  getIcebreakerPrompt,
  createIcebreakerPrompt,
  updateIcebreakerPrompt,
  updateIcebreakerPromptStatus,
  deleteIcebreakerPrompt
};
