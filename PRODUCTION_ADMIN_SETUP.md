# 🔐 Production Admin Setup Guide for AMP Lodge

## Important: Admin Account Setup for Production

### 🚨 CRITICAL: Admin Accounts Are NOT Auto-Created in Production

The application **WILL NOT** automatically create admin accounts when deployed to production. This is a security feature to prevent unauthorized access.

## Step 1: Create Admin Account in Blink Dashboard

### Option A: Using Blink Dashboard (Recommended)

1. **Log in to your Blink dashboard**
   - Go to https://app.blink.new
   - Log in with your Blink account credentials

2. **Navigate to Authentication/Users Section**
   - Go to Authentication or Users management
   - Create a new user account

3. **Create Admin User**
   - Email: `admin@amplodge.net` (or your preferred email)
   - Password: **Choose a strong password**
   - Role: Admin
   - Status: Active

4. **Record Credentials Securely**
   - Email: _______________
   - Password: _______________
   - **NEVER share these credentials or commit them to code**

### Option B: Using Blink API

```bash
# Using curl (replace with your Blink API credentials)
curl -X POST https://api.blink.new/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@amplodge.net",
    "password": "YourSecurePassword123!",
    "metadata": {
      "role": "admin",
      "hotel": "AMP Lodge"
    }
  }'
```

## Step 2: Create Admin Staff Record

After creating the user account, you need to create a staff record in your database.

### Using Blink Dashboard

1. **Go to Database Section**
   - Navigate to Tables > `staff` table
   - Click "Insert New Record"

2. **Create Staff Record**
   ```json
   {
     "id": "staff_admin_production",
     "userId": "[Your admin user ID from step 1]",
     "name": "Admin User",
     "email": "admin@amplodge.net",
     "role": "admin",
     "createdAt": "[Current timestamp in ISO format]"
   }
   ```

### Using SQL (if Blink supports it)

```sql
INSERT INTO staff (id, userId, name, email, role, createdAt)
VALUES (
  'staff_admin_production',
  '[admin-user-id-from-step-1]',
  'Admin User',
  'admin@amplodge.net',
  'admin',
  NOW()
);
```

## Step 3: Create Additional Staff Accounts (Optional)

### For Staff Members

1. **Create user account** in Blink authentication
   - Email: `staff@amplodge.net`
   - Password: Secure password
   - Role: Staff

2. **Create staff record** in the database
   ```json
   {
     "id": "staff_001",
     "userId": "[staff-user-id]",
     "name": "Staff Member",
     "email": "staff@amplodge.net",
     "role": "staff",
     "createdAt": "[timestamp]"
   }
   ```

## Step 4: Verify Admin Login

1. **Go to your production website**: `https://amplodge.net`
2. **Navigate to Staff Login**: `https://amplodge.net/staff/login`
3. **Login with your admin credentials**
4. **Verify you have admin access** to the dashboard

## Step 5: Security Best Practices

### 🔒 Password Security

- Use a strong password (minimum 16 characters)
- Include uppercase, lowercase, numbers, and symbols
- Example: `MyH0t3l@Adm1n!2025`
- **NEVER use default passwords in production**

### 🔑 Credential Storage

- Store credentials in a secure password manager
- Use separate credentials for different environments
- Never commit credentials to version control
- Share credentials only through secure channels

### 👥 Multiple Admin Accounts

Consider creating multiple admin accounts:
1. **Primary Admin**: For daily operations
2. **Backup Admin**: In case primary is locked out
3. **Audit Admin**: For compliance and audit trails

### 📧 Email Considerations

**Recommended admin email format**: `admin@amplodge.net`

This looks professional and is brand-consistent. You can also use:
- `admin@amplodge.com`
- `management@amplodge.net`
- Or any other email you control

## Step 6: Database Access

### Current Database Configuration

Your application uses **Blink SDK** for database access.

**Project ID**: `amp-lodge-hotel-management-system-j2674r7k`

This is already configured and should work automatically in production.

### Required Tables

Ensure these tables exist in your Blink database:

1. ✅ `bookings` - For reservations
2. ✅ `guests` - For guest information
3. ✅ `rooms` - For room management
4. ✅ `roomTypes` - For room categories
5. ✅ `staff` - For staff members
6. ✅ `properties` - For property management
7. ✅ `invoices` - For billing
8. ✅ `contactMessages` - For contact forms
9. ⚠️ `activityLogs` - **MUST BE CREATED** (see below)

## Step 7: Create Activity Logs Table

### In Blink Dashboard

1. Go to Database > Tables
2. Click "Create New Table"
3. Name: `activityLogs`
4. Add columns:

| Column | Type | Required | Default |
|--------|------|----------|---------|
| id | TEXT | Yes | Primary Key |
| action | TEXT | Yes | - |
| entityType | TEXT | Yes | - |
| entityId | TEXT | Yes | - |
| details | TEXT | Yes | - |
| userId | TEXT | Yes | - |
| metadata | TEXT | Yes | - |
| createdAt | TEXT | Yes | - |

### Or Using SQL

```sql
CREATE TABLE activityLogs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entityType TEXT NOT NULL,
  entityId TEXT NOT NULL,
  details TEXT NOT NULL,
  userId TEXT NOT NULL,
  metadata TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
```

## Troubleshooting

### Issue: Cannot Login as Admin

**Solutions**:
1. Verify the staff record exists in the database
2. Check that the userId matches the authentication user ID
3. Verify the email matches exactly (case-sensitive)
4. Ensure the staff record has `role: 'admin'`

### Issue: Database Connection Fails

**Solutions**:
1. Verify Blink project ID is correct
2. Check network connectivity
3. Verify SSL/TLS is enabled
4. Check Blink dashboard for any restrictions

### Issue: Admin Seeding Still Runs

**Note**: Admin seeding is automatically disabled in production mode. The application will NOT create admin accounts automatically.

## Post-Deployment Verification

After deploying to production:

- [ ] Admin account created in Blink dashboard
- [ ] Staff record created in database
- [ ] Can log in to admin panel
- [ ] Database tables exist
- [ ] Activity logging works
- [ ] Can create/edit bookings
- [ ] Can manage staff
- [ ] All features accessible

## Security Checklist

- [ ] Strong admin password set
- [ ] Staff records linked to correct user IDs
- [ ] Database access is properly restricted
- [ ] HTTPS is enabled on production site
- [ ] Credentials stored securely
- [ ] No default passwords in use
- [ ] Activity logging enabled and working
- [ ] Backup admin account created

## Support

For Blink-related issues:
- Blink Dashboard: https://app.blink.new
- Blink Documentation: https://docs.blink.new

For deployment issues:
- Hostinger Support: support@hostinger.com
- Check server logs in Hostinger panel


