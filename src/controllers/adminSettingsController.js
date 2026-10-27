const Setting = require('../models/Setting');

const EDITABLE_FIELDS = [
  'platformName',
  'tagline',
  'maxCallDurationMinutes',
  'requireMicPermissionBeforeCall',
  'allowOnlineStatusToggle',
  'minInterestsRequired',
  'maxInterestsAllowed',
  'friendRequestRateLimitPerHour',
  'autoFlagReportThreshold'
];

/**
 * Controller: GET /api/v1/admin/settings
 * Retrieve the singleton platform and voice configuration settings document.
 */
async function getSettings(req, res, next) {
  try {
    const settings = await Setting.getSingletonSettings();

    return res.status(200).json({
      success: true,
      settings: Setting.sanitize(settings)
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: PUT /api/v1/admin/settings
 * Update editable platform configuration settings with strict validation.
 */
async function updateSettings(req, res, next) {
  try {
    const body = req.body || {};

    // 1. Verify at least one editable field is provided
    const providedEditableFields = Object.keys(body).filter((key) => EDITABLE_FIELDS.includes(key));
    if (providedEditableFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid editable settings fields provided.'
      });
    }

    const currentSettings = await Setting.getSingletonSettings();

    // 2. Validate platformName
    if (body.platformName !== undefined) {
      if (typeof body.platformName !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Platform name must be a string between 1 and 100 characters.'
        });
      }
      const trimmed = body.platformName.trim();
      if (trimmed.length < 1 || trimmed.length > 100) {
        return res.status(400).json({
          success: false,
          error: 'Platform name must be a string between 1 and 100 characters.'
        });
      }
      currentSettings.platformName = trimmed;
    }

    // 3. Validate tagline
    if (body.tagline !== undefined) {
      if (typeof body.tagline !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Tagline must be a string up to 200 characters.'
        });
      }
      const trimmed = body.tagline.trim();
      if (trimmed.length > 200) {
        return res.status(400).json({
          success: false,
          error: 'Tagline must be a string up to 200 characters.'
        });
      }
      currentSettings.tagline = trimmed;
    }

    // 4. Validate maxCallDurationMinutes
    if (body.maxCallDurationMinutes !== undefined) {
      if (
        typeof body.maxCallDurationMinutes !== 'number' ||
        !Number.isInteger(body.maxCallDurationMinutes) ||
        body.maxCallDurationMinutes < 1 ||
        body.maxCallDurationMinutes > 1440
      ) {
        return res.status(400).json({
          success: false,
          error: 'Maximum call duration must be an integer between 1 and 1440 minutes.'
        });
      }
      currentSettings.maxCallDurationMinutes = body.maxCallDurationMinutes;
    }

    // 5. Validate requireMicPermissionBeforeCall
    if (body.requireMicPermissionBeforeCall !== undefined) {
      if (typeof body.requireMicPermissionBeforeCall !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'requireMicPermissionBeforeCall must be a boolean.'
        });
      }
      currentSettings.requireMicPermissionBeforeCall = body.requireMicPermissionBeforeCall;
    }

    // 6. Validate allowOnlineStatusToggle
    if (body.allowOnlineStatusToggle !== undefined) {
      if (typeof body.allowOnlineStatusToggle !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'allowOnlineStatusToggle must be a boolean.'
        });
      }
      currentSettings.allowOnlineStatusToggle = body.allowOnlineStatusToggle;
    }

    // 7. Validate minInterestsRequired
    if (body.minInterestsRequired !== undefined) {
      if (
        typeof body.minInterestsRequired !== 'number' ||
        !Number.isInteger(body.minInterestsRequired) ||
        body.minInterestsRequired < 1 ||
        body.minInterestsRequired > 20
      ) {
        return res.status(400).json({
          success: false,
          error: 'minInterestsRequired must be an integer between 1 and 20.'
        });
      }
    }

    // 8. Validate maxInterestsAllowed
    if (body.maxInterestsAllowed !== undefined) {
      if (
        typeof body.maxInterestsAllowed !== 'number' ||
        !Number.isInteger(body.maxInterestsAllowed) ||
        body.maxInterestsAllowed < 1 ||
        body.maxInterestsAllowed > 50
      ) {
        return res.status(400).json({
          success: false,
          error: 'maxInterestsAllowed must be an integer between 1 and 50.'
        });
      }
    }

    // Cross-field validation: minInterestsRequired <= maxInterestsAllowed
    const targetMin = body.minInterestsRequired !== undefined
      ? body.minInterestsRequired
      : currentSettings.minInterestsRequired;

    const targetMax = body.maxInterestsAllowed !== undefined
      ? body.maxInterestsAllowed
      : currentSettings.maxInterestsAllowed;

    if (targetMin > targetMax) {
      return res.status(400).json({
        success: false,
        error: 'minInterestsRequired cannot be greater than maxInterestsAllowed.'
      });
    }

    if (body.minInterestsRequired !== undefined) {
      currentSettings.minInterestsRequired = body.minInterestsRequired;
    }
    if (body.maxInterestsAllowed !== undefined) {
      currentSettings.maxInterestsAllowed = body.maxInterestsAllowed;
    }

    // 9. Validate friendRequestRateLimitPerHour
    if (body.friendRequestRateLimitPerHour !== undefined) {
      if (
        typeof body.friendRequestRateLimitPerHour !== 'number' ||
        !Number.isInteger(body.friendRequestRateLimitPerHour) ||
        body.friendRequestRateLimitPerHour < 1 ||
        body.friendRequestRateLimitPerHour > 500
      ) {
        return res.status(400).json({
          success: false,
          error: 'friendRequestRateLimitPerHour must be an integer between 1 and 500.'
        });
      }
      currentSettings.friendRequestRateLimitPerHour = body.friendRequestRateLimitPerHour;
    }

    // 10. Validate autoFlagReportThreshold
    if (body.autoFlagReportThreshold !== undefined) {
      if (
        typeof body.autoFlagReportThreshold !== 'number' ||
        !Number.isInteger(body.autoFlagReportThreshold) ||
        body.autoFlagReportThreshold < 1 ||
        body.autoFlagReportThreshold > 100
      ) {
        return res.status(400).json({
          success: false,
          error: 'autoFlagReportThreshold must be an integer between 1 and 100.'
        });
      }
      currentSettings.autoFlagReportThreshold = body.autoFlagReportThreshold;
    }

    // Save persisted updates
    await currentSettings.save();

    return res.status(200).json({
      success: true,
      message: 'Platform settings updated successfully.',
      settings: Setting.sanitize(currentSettings)
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSettings,
  updateSettings
};
