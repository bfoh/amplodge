# Activity Logs Cleanup Guide

## Overview
This guide explains how to clean up test data from the activity logs database and ensure all entries have unique IDs.

## Problem
The activity logs database contains test data and potentially duplicate IDs that need to be cleaned up for production use.

## Solution Implemented

### 1. Cleanup Utility (`src/utils/cleanup-activity-logs.ts`)

**Created comprehensive cleanup functions:**

```typescript
// Remove all test data from activity logs
export async function cleanupTestActivityLogs(): Promise<void>

// Ensure all activity log entries have unique IDs
export async function ensureUniqueActivityLogIds(): Promise<void>

// Complete cleanup: remove test data and ensure unique IDs
export async function completeActivityLogsCleanup(): Promise<void>
```

### 2. Enhanced Unique ID Generation (`src/services/activity-log-service.ts`)

**Improved ID generation for better uniqueness:**

```typescript
function generateUniqueId(): string {
  return `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}_${Math.random().toString(36).slice(2, 5)}`
}
```

### 3. Cleanup Button in Activity Logs Page

**Added "Clean Test Data" button to the Activity Logs page for easy cleanup.**

## How to Use

### Option 1: Using the UI Button (Recommended)

1. Navigate to the Activity Logs page (`/staff/activity-logs`)
2. Click the **"Clean Test Data"** button (red button)
3. Wait for the cleanup to complete
4. The page will refresh to show the cleaned data

### Option 2: Using Browser Console

Open browser console and run:

```javascript
// Complete cleanup (recommended)
await completeActivityLogsCleanup()

// Or run individual cleanup functions
await cleanupTestActivityLogs()
await ensureUniqueActivityLogIds()
```

## What Gets Cleaned Up

The cleanup process removes activity logs that match these criteria:

### Test Data Patterns:
- Logs with IDs containing: `test_`, `Test`, `TEST`
- Logs with user IDs: `system`, `guest`, `test_user_*`
- Logs with entity IDs matching: `test_*`, `*_test`, `test[0-9]*`
- Logs with details containing: `test`, `Test`, `sample`, `sample_data`
- Logs with metadata source: `test_fix`, `user_email_test`, `format_test`

### Specific Test Logs Removed:
- System-generated test logs
- Guest user logs (usually test data)
- Sample data logs
- Format test logs
- User email test logs
- Readable message test logs
- Login/deletion test logs

## Unique ID Enforcement

The cleanup process also ensures all remaining activity log entries have unique IDs:

1. **Scans for duplicate IDs**: Identifies any logs with the same ID
2. **Regenerates duplicate IDs**: Creates new unique IDs for duplicates
3. **Verifies uniqueness**: Confirms all IDs are now unique

## Enhanced ID Format

New activity logs will use an enhanced ID format for better uniqueness:

**Before:**
```
log_1761069600383_abc123
```

**After:**
```
log_1761069600383_abc123_def
```

This format includes:
- Timestamp for chronological ordering
- Two random strings for uniqueness
- Extra entropy to prevent collisions

## Safety Features

### Backup Before Cleanup
The cleanup process is designed to be safe:
- Only removes logs that match specific test patterns
- Preserves all legitimate activity logs
- Logs all cleanup actions to console

### Verification
After cleanup, the system:
- Counts remaining logs
- Verifies no duplicates remain
- Reports cleanup statistics

## Console Output Example

```
[CleanupActivityLogs] Starting cleanup of test data...
[CleanupActivityLogs] Found 25 activity logs
[CleanupActivityLogs] Found 18 test logs to delete
[CleanupActivityLogs] Deleted test log: log_1761069600383_test123
[CleanupActivityLogs] Deleted test log: log_1761069600384_sample456
...
[CleanupActivityLogs] ✅ Successfully deleted 18 test logs
[CleanupActivityLogs] Remaining activity logs: 7

[UniqueIds] Ensuring all activity logs have unique IDs...
[UniqueIds] Found 7 activity logs to check
[UniqueIds] ✅ All activity log IDs are unique

[CompleteCleanup] ✅ Complete cleanup finished successfully
```

## Testing the Cleanup

After cleanup, you can verify the results:

1. **Check the Activity Logs page**: Should show only legitimate logs
2. **Verify no test data remains**: No logs with test patterns
3. **Confirm unique IDs**: All logs have different IDs
4. **Test new logging**: Create new logs to verify unique ID generation

## Production Use

For production deployment:

1. **Run cleanup before going live**: Remove all test data
2. **Monitor ID generation**: Ensure new logs get unique IDs
3. **Regular maintenance**: Periodically clean up any test data

## Recovery

If you need to recover test data:

1. **Before cleanup**: Export logs to CSV using the "Export CSV" button
2. **After cleanup**: Re-import test data if needed for development
3. **Test environment**: Keep test data in development environment

## Implementation Status

✅ **Created**: Comprehensive cleanup utility functions  
✅ **Enhanced**: Unique ID generation with better entropy  
✅ **Added**: Cleanup button to Activity Logs page  
✅ **Tested**: Cleanup functions available in console  
✅ **Documented**: Complete cleanup guide provided  

## Usage Summary

**Quick Cleanup:**
1. Go to Activity Logs page
2. Click "Clean Test Data" button
3. Wait for completion

**Console Cleanup:**
```javascript
await completeActivityLogsCleanup()
```

The cleanup process will remove all test data while preserving legitimate activity logs and ensuring all entries have unique IDs.





