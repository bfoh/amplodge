import { MapPin, Utensils, Info, Phone } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import { Button } from '../../components/ui/button'

const LOCAL_GEMS = {
    eat: [
        {
            name: "The Fisherman's Rest",
            type: "Seafood • $$$",
            desc: "Fresh daily catch with ocean views. Best for sunset dinner.",
            distance: "5 min drive",
            phone: "+233 55 555 5555"
        },
        {
            name: "Mama's Kitchen",
            type: "Local • $",
            desc: "Authentic Jollof and Banku. A favorite among locals.",
            distance: "10 min walk",
        },
        {
            name: "Blue Lagooon Bar",
            type: "Drinks & Snacks • $$",
            desc: "Chill vibes, live music on weekends.",
            distance: "7 min drive"
        }
    ],
    do: [
        {
            name: "Kakum National Park",
            type: "Nature",
            desc: "Walk on the famous canopy walkway. Arrive early!",
            distance: "45 min drive"
        },
        {
            name: "Cape Coast Castle",
            type: "History",
            desc: "Powerful historical tour. Guide recommended.",
            distance: "20 min drive"
        },
        {
            name: "Local Market Tour",
            type: "Culture",
            desc: "Experience the vibrant colors and sounds of the market.",
            distance: "15 min drive"
        }
    ],
    practical: [
        {
            name: "City Pharmacy",
            type: "Health",
            desc: "Open 24/7. Located on Main St.",
            phone: "+233 20 000 0000"
        },
        {
            name: "Forex Bureau",
            type: "Money",
            desc: "Best rates for USD/EUR exchange.",
            distance: "Downtown"
        }
    ]
}

export function ConciergePage() {
    return (
        <div className="space-y-6 pb-20 animate-fade-in">
            <div>
                <h2 className="text-2xl font-bold">Local Guide</h2>
                <p className="text-muted-foreground">Curated recommendations for your stay.</p>
            </div>

            <Tabs defaultValue="eat" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="eat">Eat & Drink</TabsTrigger>
                    <TabsTrigger value="do">Activities</TabsTrigger>
                    <TabsTrigger value="info">Info</TabsTrigger>
                </TabsList>

                <TabsContent value="eat" className="space-y-4 data-[state=active]:animate-in data-[state=active]:fade-in-50 data-[state=active]:slide-in-from-bottom-2">
                    {LOCAL_GEMS.eat.map((place, i) => (
                        <GemCard key={i} item={place} icon={<Utensils className="w-4 h-4" />} />
                    ))}
                </TabsContent>

                <TabsContent value="do" className="space-y-4 data-[state=active]:animate-in data-[state=active]:fade-in-50 data-[state=active]:slide-in-from-bottom-2">
                    {LOCAL_GEMS.do.map((place, i) => (
                        <GemCard key={i} item={place} icon={<MapPin className="w-4 h-4" />} />
                    ))}
                </TabsContent>

                <TabsContent value="info" className="space-y-4 data-[state=active]:animate-in data-[state=active]:fade-in-50 data-[state=active]:slide-in-from-bottom-2">
                    {LOCAL_GEMS.practical.map((place, i) => (
                        <GemCard key={i} item={place} icon={<Info className="w-4 h-4" />} />
                    ))}
                </TabsContent>
            </Tabs>
        </div>
    )
}

function GemCard({ item, icon }: { item: any, icon: any }) {
    return (
        <Card>
            <CardHeader className="p-4 pb-2">
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle className="text-lg font-semibold">{item.name}</CardTitle>
                        <CardDescription className="flex items-center gap-1 mt-1">
                            {icon} {item.type}
                        </CardDescription>
                    </div>
                    {item.distance && (
                        <span className="text-xs bg-muted px-2 py-1 rounded text-muted-foreground whitespace-nowrap">
                            {item.distance}
                        </span>
                    )}
                </div>
            </CardHeader>
            <CardContent className="p-4 pt-2">
                <p className="text-sm text-gray-600 mb-3">{item.desc}</p>
                {item.phone && (
                    <Button variant="outline" size="sm" className="w-full" asChild>
                        <a href={`tel:${item.phone}`}>
                            <Phone className="w-3 h-3 mr-2" />
                            Call
                        </a>
                    </Button>
                )}
            </CardContent>
        </Card>
    )
}
