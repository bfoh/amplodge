import { Outlet } from "react-router-dom";
import { User, Phone, MapPin, Coffee, LogOut } from "lucide-react";
import { Link } from "react-router-dom";

export default function GuestLayout() {
    return (
        <div className="min-h-screen bg-neutral-50 flex flex-col font-sans">
            {/* Header */}
            <header className="bg-white border-b px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
                <div className="flex items-center gap-2">
                    <img src="/amp-logo.png" alt="AMP Lodge" className="h-8 w-8 object-contain rounded-lg" />
                    <span className="font-semibold text-lg tracking-tight">AMP Lodge</span>
                </div>
                <div className="flex items-center gap-2">
                    {/* Contextual actions could go here */}
                </div>
            </header>

            {/* Main Content Area */}
            <main className="flex-1 w-full max-w-md mx-auto p-4 pb-24">
                <Outlet />
            </main>

            {/* Fixed Bottom Navigation - Mobile App Style */}
            <nav className="fixed bottom-0 left-0 right-0 bg-white border-t p-2 pb-safe">
                <div className="max-w-md mx-auto flex justify-around items-center">
                    <NavLink to="" icon={<User className="w-5 h-5" />} label="My Stay" />
                    <NavLink to="concierge" icon={<MapPin className="w-5 h-5" />} label="Concierge" />
                    <NavLink to="services" icon={<Coffee className="w-5 h-5" />} label="Services" />
                    <NavLink to="help" icon={<Phone className="w-5 h-5" />} label="Help" />
                </div>
            </nav>
        </div>
    );
}

function NavLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
    // Basic active state logic could be added here manually or via useLocation
    return (
        <Link to={to} className="flex flex-col items-center gap-1 p-2 text-neutral-500 hover:text-black transition-colors">
            {icon}
            <span className="text-[10px] font-medium">{label}</span>
        </Link>
    )
}
