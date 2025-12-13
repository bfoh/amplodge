# Production Deployment Guide for AMP Lodge

## 🚀 Deployment Checklist for amplodge.net

### Pre-Deployment Checklist

#### 1. Remove Development Tools ✅
- [x] Remove all test/debug UI elements
- [x] Remove diagnostic tools and test buttons
- [ ] Remove console.log statements in production code
- [ ] Remove development-only imports

#### 2. Environment Configuration
- [ ] Create `.env.production` file
- [ ] Configure Blink SDK for production
- [ ] Set production API keys
- [ ] Configure domain-specific settings

#### 3. Build Configuration
- [ ] Update Vite config for production
- [ ] Configure build optimizations
- [ ] Set up asset compression
- [ ] Configure CDN settings

#### 4. Database Setup
- [ ] Create production database
- [ ] Create `activity_logs` table
- [ ] Remove sample/test data
- [ ] Set up proper access controls

#### 5. Hosting Setup (Hostinger)
- [ ] Configure custom domain
- [ ] Set up SSL certificate
- [ ] Configure DNS settings
- [ ] Set up static file hosting

### Deployment Steps

## Step 1: Environment Configuration

Create a `.env.production` file in the project root:

```env
# Production Environment
VITE_ENVIRONMENT=production
VITE_APP_URL=https://amplodge.net

# Blink SDK Configuration
VITE_BLINK_PROJECT_ID=amp-lodge-hotel-management-system-j2674r7k
VITE_BLINK_AUTH_REQUIRED=false

# API Configuration
VITE_API_URL=https://amplodge.net/api
```

## Step 2: Update Vite Configuration

Create `vite.config.production.ts`:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Remove all console.log statements
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui': ['@/components/ui'],
          'lucide': ['lucide-react'],
        },
      },
    },
  },
  server: {
    port: 3000,
  },
})
```

## Step 3: Database Setup

### Create Activity Logs Table

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

### Remove Sample Data

Update `src/services/test-sample-data.ts` to NOT seed sample data in production:

```typescript
export async function testAndCreateSampleData() {
  // Skip seeding in production
  if (import.meta.env.PROD) {
    return
  }
  
  // Only seed in development
  // ... existing seeding code
}
```

## Step 4: Remove Console Logs

Create a script to remove all console.log statements:

```bash
# Remove console.log statements (optional)
# This is already handled by terser in the build config
```

Or manually remove/comment out console.log statements in:
- `src/pages/BookingPage.tsx`
- `src/services/booking-engine.ts`
- `src/pages/staff/BookingsPage.tsx`
- Other development files

## Step 5: Hostinger Setup

### A. Domain Configuration

1. Log in to your Hostinger account
2. Go to **Domains** > **amplodge.net**
3. Configure DNS settings:
   - A Record: `@` → Your server IP
   - A Record: `www` → Your server IP

### B. SSL Certificate

Hostinger provides free SSL certificates:
1. Go to **Websites** > **Manage**
2. Find your site
3. Click **SSL/TLS**
4. Enable **Auto HTTPS**

### C. Upload Files

Option 1: Using File Manager
1. Go to **File Manager**
2. Navigate to `public_html` or your domain folder
3. Upload the contents of the `dist` folder

Option 2: Using FTP
```bash
# Build the project first
npm run build

# Upload using FTP client
# Host: your-ftp-host
# Username: your-username
# Password: your-password
# Upload all files from dist/ to public_html/
```

### D. Configure Web Server

Create `.htaccess` file in the project root for Apache:

```apache
# AMP Lodge .htaccess

# Enable Rewrite Engine
RewriteEngine On

# Redirect to HTTPS
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}/$1 [R=301,L]

# Remove www (or add www - choose one)
RewriteCond %{HTTP_HOST} ^www\.(.*)$ [NC]
RewriteRule ^(.*)$ https://%1/$1 [R=301,L]

# Handle React Router
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.html [L]

# Compression
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html
  AddOutputFilterByType DEFLATE text/css
  AddOutputFilterByType DEFLATE text/javascript
  AddOutputFilterByType DEFLATE application/javascript
  AddOutputFilterByType DEFLATE application/json
</IfModule>

# Cache Control
<IfModule mod_expires.c>
  ExpiresActive on
  ExpiresByType image/jpg "access plus 1 year"
  ExpiresByType image/jpeg "access plus 1 year"
  ExpiresByType image/gif "access plus 1 year"
  ExpiresByType image/png "access plus 1 year"
  ExpiresByType image/webp "access plus 1 year"
  ExpiresByType text/css "access plus 1 month"
  ExpiresByType application/javascript "access plus 1 month"
</IfModule>
```

## Step 6: Build and Deploy

### Build the Production Version

```bash
# Install dependencies
npm install

# Build for production
npm run build

# The build output will be in the dist/ folder
```

### Upload to Hostinger

1. **Compress the build**:
   ```bash
   cd dist
   tar -czf ../amplodge-production.tar.gz .
   ```

2. **Upload via File Manager**:
   - Log in to Hostinger
   - Navigate to File Manager
   - Go to `public_html`
   - Upload `amplodge-production.tar.gz`
   - Extract the files

3. **Set proper permissions**:
   ```bash
   chmod 755 public_html
   chmod 644 public_html/*
   ```

### Verify Deployment

1. Visit `https://amplodge.net`
2. Check that the app loads correctly
3. Test booking functionality
4. Verify SSL certificate
5. Check mobile responsiveness

## Step 7: Post-Deployment

### Security Checklist

- [ ] Enable HTTPS only
- [ ] Configure CORS properly
- [ ] Set up rate limiting
- [ ] Enable security headers
- [ ] Configure firewall rules

### Performance Optimization

- [ ] Enable CDN (if using)
- [ ] Configure caching
- [ ] Optimize images
- [ ] Minify JavaScript/CSS
- [ ] Enable Gzip compression

### Monitoring

- [ ] Set up error tracking (Sentry, etc.)
- [ ] Configure analytics (Google Analytics)
- [ ] Set up uptime monitoring
- [ ] Monitor API usage

## Step 8: Domain-Specific Configuration

Update `src/blink/client.ts` to use production settings:

```typescript
export const blink = createClient({
  projectId: 'amp-lodge-hotel-management-system-j2674r7k',
  authRequired: false,
  auth: {
    mode: 'headless'
  },
  // Add production-specific configuration
  ...(import.meta.env.PROD && {
    // Production-specific settings
  })
})
```

## Troubleshooting

### Issue: Blank Page After Deployment
**Solution**: Check if the `.htaccess` file is configured correctly and the build files are uploaded properly.

### Issue: API Errors
**Solution**: Verify that the Blink SDK configuration is correct and the database tables exist.

### Issue: Slow Loading
**Solution**: Enable compression, optimize images, and configure CDN.

### Issue: SSL Certificate Not Working
**Solution**: Enable Auto HTTPS in Hostinger panel and wait for propagation.

## Additional Resources

- [Hostinger Knowledge Base](https://www.hostinger.com/tutorials)
- [Vite Deployment Guide](https://vitejs.dev/guide/static-deploy.html)
- [Blink SDK Documentation](https://docs.blink.new)

## Support

For deployment issues, contact:
- Hostinger Support: support@hostinger.com
- Developer: [Your contact information]



