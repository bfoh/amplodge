# Production Setup for AMP Lodge

## 🚀 Quick Deployment Guide

### Pre-Deployment Checklist

- [x] Remove all test/debug UI elements from BookingPage
- [x] Remove diagnostic tools and test buttons
- [x] Update Vite config for production builds
- [x] Add production build scripts
- [ ] Remove console.log statements
- [ ] Create activity_logs table in Blink
- [ ] Remove sample data seeding in production

### Step 1: Environment Setup

Create a `.env.production` file in the project root:

```env
VITE_ENVIRONMENT=production
VITE_APP_URL=https://amplodge.net
VITE_APP_NAME=AMP Lodge
VITE_BLINK_PROJECT_ID=amp-lodge-hotel-management-system-j2674r7k
```

### Step 2: Build for Production

```bash
# Install dependencies
npm install

# Build for production
npm run build

# The output will be in the dist/ folder
```

### Step 3: Create Activity Logs Table

Go to your Blink dashboard and create the `activity_logs` table:

```sql
CREATE TABLE activity_logs (
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

### Step 4: Update Sample Data Service

Update `src/services/test-sample-data.ts` to skip seeding in production:

```typescript
export async function testAndCreateSampleData() {
  // Skip in production
  if (import.meta.env.PROD) {
    return
  }
  
  // Only run in development
  // ... existing code
}
```

### Step 5: Deploy to Hostinger

#### Option A: Using File Manager

1. Log in to your Hostinger account
2. Go to **File Manager** > **public_html**
3. Upload all files from the `dist/` folder
4. Create `.htaccess` file (see below)

#### Option B: Using FTP

```bash
# Build the project
npm run build

# Upload using your FTP client
# Upload all files from dist/ to public_html/
```

### Step 6: Configure .htaccess

Create a `.htaccess` file in your public_html directory:

```apache
# Enable Rewrite Engine
RewriteEngine On

# Redirect to HTTPS
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}/$1 [R=301,L]

# Handle React Router
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.html [L]

# Compression
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css text/javascript application/javascript application/json
</IfModule>

# Cache Control
<IfModule mod_expires.c>
  ExpiresActive on
  ExpiresByType image/jpg "access plus 1 year"
  ExpiresByType image/png "access plus 1 year"
  ExpiresByType text/css "access plus 1 month"
  ExpiresByType application/javascript "access plus 1 month"
</IfModule>
```

### Step 7: Domain Configuration

1. Log in to Hostinger
2. Go to **Domains** > **amplodge.net**
3. Configure DNS:
   - A Record: `@` → Your server IP
   - A Record: `www` → Your server IP

### Step 8: SSL Certificate

Hostinger provides free SSL:
1. Go to **Websites** > **Manage**
2. Click **SSL/TLS**
3. Enable **Auto HTTPS**

## Post-Deployment

### Verify Deployment

1. Visit `https://amplodge.net`
2. Test booking functionality
3. Check activity logs
4. Verify SSL certificate
5. Test on mobile devices

### Security Checklist

- [ ] HTTPS is enabled
- [ ] SSL certificate is valid
- [ ] All API endpoints are secured
- [ ] CORS is configured properly
- [ ] Error messages don't expose sensitive info

### Performance Optimization

- [ ] Enable CDN (optional)
- [ ] Configure browser caching
- [ ] Optimize images
- [ ] Monitor page load times

## Support

For issues during deployment:
- Check the browser console for errors
- Verify database connection
- Check server logs in Hostinger panel



