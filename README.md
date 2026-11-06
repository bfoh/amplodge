# AMP Lodge Hotel Management System

Modern, full-stack hotel management system with guest-facing and staff portals.

## Features

### Guest Portal
- Browse available rooms with real-time availability
- Multi-step booking flow
- Image gallery with lightbox
- Virtual 3D tour
- Contact form

### Staff Portal
- Secure authentication
- Dashboard with analytics and stats
- Reservation management (view, edit, cancel)
- Room management (CRUD operations)
- Guest management with booking history
- Over-the-counter (walk-in) bookings
- End-of-day reports

## Tech Stack

- **Frontend:** React + TypeScript + Vite
- **Styling:** Tailwind CSS + Framer Motion
- **Backend:** Supabase (Auth, Postgres, Storage) and Netlify Functions
- **Icons:** Lucide React
- **UI Components:** Radix UI + Shadcn

## Getting Started

```bash
npm install
npm run dev
```

## Staff Accounts

There is no default login. The owner's account is created in Supabase, and admins add
every other employee on the Employees page (`/staff/employees`). The server
(`netlify/functions/create-employee.js`) creates the account and assigns its role.

## Project Structure

```
src/
├── components/     # Reusable UI components
│   └── ui/        # Shadcn UI components
├── pages/         # Route pages
│   └── staff/     # Staff portal pages
├── services/      # Business logic & utilities
├── types/         # TypeScript definitions
└── lib/           # Supabase client and shared helpers
```

## Database Schema

- **rooms** - Room inventory with pricing and images
- **room_types** - Room category definitions
- **bookings** - Reservation records
- **guests** - Guest information and profiles
- **staff** - Staff accounts with roles
- **contact_messages** - Contact form submissions
- **invoices** - Guest invoices generated at checkout
- **activityLogs** - System activity logs and audit trail

## Key Features Implemented

✅ Real-time room availability engine  
✅ Multi-step booking wizard  
✅ Staff dashboard with analytics  
✅ Walk-in booking system  
✅ End-of-day reporting  
✅ Image gallery with Firebase Storage  
✅ Virtual tour with 3D viewer  
✅ Responsive mobile design  
✅ Offline detection

## Development

- Run `npm run dev` to start development server
- Access guest portal at `http://localhost:5173`
- Access staff portal at `http://localhost:5173/staff`
