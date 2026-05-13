import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Loader2, Moon, Utensils, Wifi, CalendarCheck, MapPin } from "lucide-react";
import { toast } from "sonner";

export default function GuestDashboard() {
    const { token } = useParams();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<{ guest: any; booking: any } | null>(null);

    useEffect(() => {
        if (!token) return;

        // Verify Token
        fetch(`/.netlify/functions/verify-guest?token=${token}`)
            .then(res => res.json())
            .then(res => {
                if (res.error) {
                    toast.error("Invalid Link. Please contact the front desk.");
                    // In real app, redirect to error page
                } else {
                    setData(res);
                }
            })
            .catch(() => toast.error("Connection Error"))
            .finally(() => setLoading(false));
    }, [token]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-muted-foreground">
                <Loader2 className="w-8 h-8 animate-spin mb-4" />
                <p>Loading your stay...</p>
            </div>
        );
    }

    if (!data) return <div className="p-4 text-center">Invalid Access Link</div>;

    const { guest, booking } = data;

    return (
      <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-700 max-w-2xl mx-auto pb-10">
  
        {/* Welcome Card */}
        <section className="text-center space-y-2 py-6 sm:py-10">
          <h1 className="text-3xl sm:text-4xl font-serif font-bold tracking-tight text-foreground">Welcome, {(guest.name || 'Guest').split(' ')[0]}!</h1>
          <p className="text-sm sm:text-base text-muted-foreground font-medium">We hope you enjoy your stay at <span className="text-primary">AMP Lodge</span></p>
        </section>

            {/* Room Card */}
            <Card className="bg-black text-white border-0 shadow-lg overflow-hidden relative">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Moon className="w-32 h-32" />
                </div>
                <CardContent className="p-6 relative z-10">
                    <div className="flex justify-between items-start mb-6">
                        <div>
                            <p className="text-neutral-400 text-sm uppercase tracking-wider font-medium">Room</p>
                            <p className="text-4xl font-bold">{guest.room}</p>
                        </div>
                        <div className="text-right">
                            <p className="text-neutral-400 text-sm uppercase tracking-wider font-medium">Check Out</p>
                            <p className="text-xl font-semibold">{new Date(booking.checkOut).toLocaleDateString()}</p>
                            <p className="text-neutral-500 text-xs">11:00 AM</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-8">
                        <Button variant="secondary" className="bg-white/10 hover:bg-white/20 text-white border-0 h-auto py-3 flex-col gap-1">
                            <Wifi className="w-5 h-5" />
                            <span className="text-xs">Wi-Fi</span>
                        </Button>
                        <Button variant="secondary" className="bg-white/10 hover:bg-white/20 text-white border-0 h-auto py-3 flex-col gap-1">
                            <Utensils className="w-5 h-5" />
                            <span className="text-xs">Dining</span>
                        </Button>
                    </div>
                </CardContent>
            </Card>

        {/* Quick Actions Grid */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <Card 
            className="hover:border-primary/50 transition-all cursor-pointer group shadow-sm bg-white/50 backdrop-blur-sm border-primary/10" 
            onClick={() => navigate('concierge')}
          >
            <CardContent className="p-4 flex flex-col items-center text-center gap-2 sm:gap-3">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-orange-50 flex items-center justify-center text-orange-600 group-hover:bg-orange-600 group-hover:text-white transition-all duration-300">
                <MapPin className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div>
                <h3 className="font-bold text-sm sm:text-base">Local Guide</h3>
                <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">Explore the area</p>
              </div>
            </CardContent>
          </Card>

          <Card 
            className="hover:border-primary/50 transition-all cursor-pointer group shadow-sm bg-white/50 backdrop-blur-sm border-primary/10" 
            onClick={() => navigate('services')}
          >
            <CardContent className="p-4 flex flex-col items-center text-center gap-2 sm:gap-3">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-all duration-300">
                <CalendarCheck className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div>
                <h3 className="font-bold text-sm sm:text-base">Book Services</h3>
                <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">Spa & Transfers</p>
              </div>
            </CardContent>
          </Card>
        </div>

        </div>
    );
}
