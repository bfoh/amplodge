# ✅ AMP Lodge - Production Deployment Checklist

## Domain: amplodge.net

### 🔐 Pre-Deployment Security Checklist

#### Admin Account Setup
- [ ] **Create admin account in Blink dashboard** (See `PRODUCTION_ADMIN_SETUP.md`)
- [ ] **Create staff record in database** with `role: 'admin'`
- [ ] **Set strong admin password** (not default password)
- [ ] **Record credentials securely** in password manager
- [ ] **Test admin login** on production site
- [ ] **Verify admin access** to all staff features

#### Database Setup
- [ ] **Create `activityLogs` table** in Blink database
- [ ] **Verify all required tables exist**:
  - [ ] `bookings`
  - [ ] `guests`
  - [ ] `rooms`
  - [ ] `roomTypes`
  - [ ] `staff`
  - [ ] `properties`
  - [ ] `invoices`
  - [ ] `contactMessages`
  - [ ] `activityLogs` ⚠️ MUST CREATE
- [ ] **Verify database connection** works
- [ ] **Test database read/write operations**

### 📦 Build & Deploy Checklist

#### Code Preparation
- [x] Remove all test/debug UI elements
- [x] Remove diagnostic tools and test buttons
- [x] Update Vite config for production
- [x] Disable sample data seeding in production
- [x] Configure console.log removal
- [ ] Final code review
- [ ] Run linter: `npm run lint`
- [ ] Verify no console errors

#### Build Process
- [ ] Install dependencies: `npm install`
- [ ] Build production version: `npm run build`
- [ ] Verify build output in `dist/` folder
- [ ] Check build size (should be optimized)
- [ ] Verify no source maps in production

#### Upload to Hostinger
- [ ] Log in to Hostinger account
- [ ] Navigate to File Manager > `public_html`
- [ ] Upload all files from `dist/` folder
- [ ] Create `.htaccess` file (see below)
- [ ] Set file permissions (755 for folders, 644 for files)

### 🔧 Configuration Checklist

#### .htaccess File
Create `.htaccess` in `public_html`:

```apache
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}/$1 [R=301,L]

RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.html [L]
```

#### Domain Setup
- [ ] Go to Hostinger Domains
- [ ] Configure DNS for amplodge.net:
  - [ ] A Record: `@` → Server IP
  - [ ] A Record: `www` → Server IP
- [ ] Wait for DNS propagation (up to 24 hours)

#### SSL Certificate
- [ ] Go to Hostinger Websites > Manage
- [ ] Click SSL/TLS
- [ ] Enable Auto HTTPS
- [ ] Verify SSL certificate is active

### ✅ Post-Deployment Verification

#### Website Testing
- [ ] Visit `https://amplodge.net` (not insecure http://)
- [ ] Test homepage loads correctly
- [ ] Test navigation works
- [ ] Test mobile responsiveness
- [ ] Check for console errors in browser dev tools

#### Admin Access Testing
- [ ] Navigate to staff login page
- [ ] Log in with admin credentials
- [ ] Verify admin dashboard loads
- [ ] Verify all admin features accessible:
  - [ ] Bookings management
  - [ ] Guest management
  - [ ] Staff management
  - [ ] Reports and analytics
  - [ ] Settings

#### Booking Functionality
- [ ] Test booking creation from frontend
- [ ] Verify booking appears in admin panel
- [ ] Test booking status changes
- [ ] Test booking deletion
- [ ] Test check-in/check-out
- [ ] Verify activity logs are recording

#### Performance Testing
- [ ] Check page load speed (should be < 3 seconds)
- [ ] Test on mobile devices
- [ ] Test on different browsers (Chrome, Firefox, Safari)
- [ ] Verify images load correctly
- [ ] Check API response times

### 🛡️ Security Verification

- [ ] HTTPS is enforced (redirects http to https)
- [ ] SSL certificate is valid and trusted
- [ ] Admin credentials are secure
- [ ] No sensitive data in console
- [ ] No API keys exposed in code
- [ ] Database access is restricted
- [ ] Activity logging is working

### 📊 Database Verification

#### Test Database Operations
- [ ] Create a test booking
- [ ] Read booking data
- [ ] Update booking status
- [ ] Delete booking
- [ ] Verify activity logs created
- [ ] Check data persistence

### 🚀 Go-Live Checklist

- [ ] All tests passed
- [ ] Admin account accessible
- [ ] Booking system working
- [ ] Staff features accessible
- [ ] Activity logging operational
- [ ] SSL certificate valid
- [ ] DNS configured correctly
- [ ] Performance acceptable
- [ ] No console errors
- [ ] Mobile experience good

### 📝 Rollback Plan (If Needed)

If issues occur after deployment:

1. **Quick Fix**: Update files via Hostinger File Manager
2. **Database Issue**: Rollback in Blink dashboard
3. **Access Issue**: Use FTP to restore files
4. **Emergency**: Contact Hostinger support

### 📞 Support Resources

**Hostinger Support**:
- Email: support@hostinger.com
- Phone: Check your Hostinger panel
- Knowledge Base: https://www.hostinger.com/tutorials

**Blink Support**:
- Dashboard: https://app.blink.new
- Documentation: https://docs.blink.new
- Support: Check Blink dashboard for contact info

### 📋 Documentation Files

Review these files before deployment:
- ✅ `PRODUCTION_DEPLOYMENT_GUIDE.md` - Full deployment guide
- ✅ `PRODUCTION_SETUP.md` - Quick setup instructions
- ✅ `PRODUCTION_ADMIN_SETUP.md` - Admin account setup
- ✅ `DEPLOYMENT_SUMMARY.md` - Deployment overview
- ✅ `PRODUCTION_CHECKLIST.md` - This checklist

## 🎉 Ready to Deploy!

Once all checkboxes are marked, your application is ready for production deployment to amplodge.net!



