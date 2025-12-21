-- Add manager notification fields to hotel_settings table
-- These fields allow configuring manager notifications for check-ins

-- Add manager email field
ALTER TABLE hotel_settings
ADD COLUMN IF NOT EXISTS manager_email TEXT;

-- Add manager phone field
ALTER TABLE hotel_settings
ADD COLUMN IF NOT EXISTS manager_phone TEXT;

-- Add notifications enabled toggle
ALTER TABLE hotel_settings
ADD COLUMN IF NOT EXISTS manager_notifications_enabled BOOLEAN DEFAULT true;

-- Update existing record with default values
UPDATE hotel_settings
SET 
    manager_email = 'manager@amplodge.org',
    manager_phone = '+233555009697',
    manager_notifications_enabled = true
WHERE manager_email IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN hotel_settings.manager_email IS 'Email address for manager check-in notifications';
COMMENT ON COLUMN hotel_settings.manager_phone IS 'Phone number for manager check-in SMS notifications';
COMMENT ON COLUMN hotel_settings.manager_notifications_enabled IS 'Whether to send manager notifications on guest check-in';
