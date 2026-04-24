// English names for furniture and material items keyed by item ID
// Falls back to item.name if ID not found

export const FURNITURE_NAMES_EN: Record<string, string> = {
  // Sofa
  "sofa-fabric-gray":        "Fabric 3-Seat Sofa",
  "sofa-leather-brown":      "L-Shaped Leather Sofa",
  "sofa-nordic-blue":        "Nordic Velvet Sofa",
  "sofa-japanese":           "Legless Tatami Sofa",
  "sofa-modular-green":      "Modular Corner Sofa",
  // Coffee Table
  "coffee-oak-round":        "Oak Round Coffee Table",
  "coffee-marble-rect":      "Marble Square Coffee Table",
  "coffee-glass-black":      "Glass & Iron Coffee Table",
  // TV Unit
  "tvunit-float-white":      "Floating TV Unit (White)",
  "tvunit-walnut":           "Solid Wood TV Unit (Walnut)",
  "tvunit-black-stone":      "Black Sintered Stone TV Unit",
  // Floor Lamp
  "lamp-arc-gold":           "Nordic Arch Floor Lamp",
  "lamp-industrial-black":   "Industrial Iron Floor Lamp",
  // Bookshelf
  "bookshelf-open-white":    "Open Bookshelf (White)",
  "bookshelf-solid-walnut":  "Solid Wood Bookshelf (Walnut)",
  // Sideboard
  "sideboard-walnut":        "Solid Wood Entryway Cabinet",
  "sideboard-modern-black":  "Modern Black Sideboard",
  // Plants
  "plant-monstera":          "Large Monstera",
  "plant-sansevieria":       "Snake Plant",
  "plant-rubber-tree":       "Rubber Tree",
  "plant-balcony-pot":       "Balcony Planter Combo",
  // Rug
  "rug-nordic-geo":          "Nordic Geometric Rug",
  "rug-modern-gray":         "Modern Minimalist Rug",
  "rug-persian":             "Persian Style Rug",
  // Artwork
  "artwork-abstract":        "Abstract Modern Artwork",
  "artwork-inkwash":         "Landscape Ink Painting",
  // Bed
  "bed-fabric-beige":        "Fabric Upholstered Bed (Beige)",
  "bed-leather-dark":        "Leather Bed (Dark Brown)",
  "bed-wood-nordic":         "Nordic Wood Bed",
  "bed-tatami":              "Tatami Low Bed",
  "bed-single-white":        "Single Bed (White)",
  // Nightstand
  "nightstand-white":        "Modern Nightstand (White)",
  "nightstand-oak":          "Solid Wood Nightstand",
  // Wardrobe
  "wardrobe-slide-white":    "Sliding Door Wardrobe (White)",
  "wardrobe-solid-walnut":   "Solid Wood Wardrobe (Walnut)",
  "wardrobe-open-rack":      "Open Coat Rack",
  // Dresser
  "dresser-nordic-white":    "Nordic Vanity Table",
  // Walk-in Closet
  "closet-system-white":     "Walk-in Closet System",
  "closet-island-white":     "Walk-in Closet Island",
  // Dining Table
  "dining-marble-round":     "Marble Round Dining Table",
  "dining-oak-rect":         "Oak Rectangular Dining Table",
  "dining-black-metal":      "Black Sintered Stone Dining Table",
  // Dining Chair
  "chair-nordic-oak":        "Nordic Wood Dining Chair",
  "chair-modern-gray":       "Modern Dining Chair (Gray)",
  "chair-industrial-black":  "Industrial Iron Chair",
  // Kitchen Cabinet
  "cabinet-lower-white":     "Kitchen Lower Cabinet (White)",
  "cabinet-lower-gray":      "Kitchen Lower Cabinet (Gray)",
  "cabinet-upper-white":     "Kitchen Upper Cabinet (White)",
  // Kitchen Appliances
  "fridge-french-door":      "French Door Refrigerator",
  "fridge-single-white":     "Single Door Refrigerator",
  "hood-side-black":         "Side-Draft Range Hood",
  "sink-double-steel":       "Double-Basin Stainless Steel Sink",
  // Toilet
  "toilet-smart":            "Smart Integrated Toilet",
  "toilet-standard":         "Standard Toilet",
  "toilet-wallhung":         "Wall-Hung Toilet",
  // Bathtub & Shower
  "bathtub-freestanding":    "Freestanding Bathtub",
  "bathtub-builtin":         "Built-in Bathtub",
  "shower-enclosed":         "Enclosed Shower Unit",
  "shower-walkin":           "Walk-in Shower",
  // Bathroom Vanity
  "vanity-single-white":     "Single-Basin Bathroom Vanity",
  "vanity-double-marble":    "Double-Basin Stone Vanity",
  // Desk
  "desk-nordic-oak":         "Nordic Solid Wood Desk",
  "desk-l-shape-white":      "L-Shaped Desk",
  "desk-standing":           "Electric Height-Adjustable Desk",
  // Office Chair
  "chair-ergonomic":         "Ergonomic Office Chair",
  "chair-simple-fabric":     "Simple Fabric Chair",
  // Outdoor Plants
  "tree-oak":               "Oak Tree",
  "tree-pine":              "Pine Tree",
  "tree-palm":              "Palm Tree",
  "bush-flower":            "Flower Bush",
  "rose-bush":              "Rose Bed",
  "lawn-patch":             "Lawn Patch",
  "bamboo":                 "Bamboo Grove",
  "flower-bed":             "Flower Bed",
  "cherry-tree":            "Cherry Blossom Tree",
  // Hardscape
  "stone-path":             "Stone Path",
  "deck":                   "Wooden Deck",
  "fence":                  "Garden Fence",
  "pergola":                "Pergola",
  "bbq-grill":              "BBQ Grill",
  "outdoor-sofa":           "Outdoor Sofa Set",
  "parking-spot":           "Parking Space",
  "car":                    "Car (Placeholder)",
  // Water
  "pond":                   "Koi Pond",
  "fountain":               "Water Fountain",
  "pool":                   "Swimming Pool",
  "hot-tub":                "Hot Tub",
  // Structures
  "greenhouse":             "Greenhouse",
  "shed":                   "Storage Shed",
  "trampoline":             "Trampoline",
  "swing":                  "Garden Swing",
  "sandbox":                "Sandbox",
  "gym-outdoor":            "Outdoor Gym Equipment",
  // Pets
  "dog-large":              "Large Dog",
  "dog-small":              "Small Dog",
  "cat":                    "Cat",
  "cat-tower":              "Cat Tree",
  "dog-house":              "Pet House",
  "rabbit":                 "Rabbit",
  "fish-tank":              "Fish Tank",
  "parrot":                 "Parrot",
  "turtle":                 "Turtle",
  "hamster":                "Hamster Cage",
  // Artworks (extended)
  "artwork-impression":     "Impressionist Landscape (Monet)",
  "artwork-vangogh":        "Van Gogh — Wheatfield with Cypresses",
  "artwork-hokusai":        "Hokusai — The Great Wave",
  "artwork-klimt-kiss":     "Klimt — The Kiss",
  "artwork-kandinsky":      "Kandinsky — Composition VIII",
  "artwork-turner":         "Turner — The Fighting Temeraire",
  "artwork-seurat":         "Seurat — La Grande Jatte",
  "artwork-vermeer":        "Vermeer — Girl with a Pearl Earring",
  "artwork-mona-lisa":      "Da Vinci — Mona Lisa",
  "artwork-degas":          "Degas — The Dance Class",
  "artwork-red-fuji":       "Hokusai — Red Fuji",

  // Curtains
  "curtain-modern-gray":    "Modern Gray Curtains",
  "curtain-brown-sheer":    "Brown Curtain with Sheer Layer",

  // Ceiling lights (extended in data.ts)
  "light-ceiling-fan":         "Ceiling Fan with Light",
  "light-ring-modern":         "Modern Ring Pendant",
  "light-crystal-chandelier":  "Crystal Chandelier (Large)",
  "light-magnetic-track":      "Magnetic Track Lighting",
  "light-smart-panel":         "Smart Ceiling Panel",
  "light-recessed":            "Recessed Downlights (Set)",

  // Bathroom / plumbing accessories
  "toilet-squat":             "Squat Toilet",
  "mirror-cabinet":           "Mirror Cabinet",
  "shower-head":              "Shower Head (Rain + Handheld)",
  "faucet-basin":             "Basin Faucet",
  "floor-drain":              "Floor Drain",
  "drain-point":              "Drain Point (DN50)",
  "exhaust-vent":             "Exhaust Vent",

  // Electrical
  "outlet-2pin":              "Standard Power Outlet",
  "outlet-usb":               "Outlet with USB",
  "switch-single":            "Single Switch",
  "switch-double":            "Double Switch",
  "breaker-panel":            "Breaker Panel",
  "weak-panel":               "Low-Voltage Panel",
  "network-jack":             "Network Jack (RJ45)",
  "tv-jack":                  "TV Jack",

  // Exterior wall decor — lights
  "wall-lamp-modern":         "Modern Wall Light",
  "wall-lamp-lantern":        "Chinese Lantern",
  "light-strip-warm":         "Warm LED Light Strip",
  "light-strip-rgb":          "RGB Light Strip",

  // Exterior wall decor — murals
  "mural-great-wave":         "Mural — The Great Wave",
  "mural-red-fuji":           "Mural — Red Fuji",
  "mural-wheatfield":         "Mural — Wheatfield & Cypresses",
  "mural-inkwash":            "Mural — Travelers Among Mountains",

  // Exterior wall decor — plaques & signage
  "couplet-spring":           "Spring Couplet — Spring Returns",
  "couplet-prosperity":       "Spring Couplet — All the Best",
  "border-meander":           "Meander Border",
  "border-floral":            "Floral Border",
  "house-number":             "House Number (888)",
  "nameplate-family":         "Family Nameplate",
  "mailbox-modern":           "Modern Mailbox",
  "ac-condenser":             "AC Outdoor Unit",
  "climbing-vine":            "Climbing Ivy",

  // Livestock
  "chicken":                "Chicken",
  "rooster":                "Rooster",
  "duck":                   "Duck",
  "goose":                  "Goose",
  "pig":                    "Pig",
  "cow":                    "Cow",
  "goat":                   "Goat",
  "sheep":                  "Sheep",
  "horse":                  "Horse",
  "chicken-coop":           "Chicken Coop",
  "barn":                   "Barn",
};

export const MATERIAL_NAMES_EN: Record<string, string> = {
  // Wall paint
  "wall-white":       "Matte White Wall Paint",
  "wall-beige":       "Warm Cream Wall Paint",
  "wall-gray":        "Premium Gray Wall Paint",
  "wall-sage":        "Sage Green Wall Paint",
  "wall-blue":        "Deep Sea Blue Wall Paint",
  "wall-warm-pink":   "Blush Pink Wall Paint",
  "wall-tile-white":  "White Marble Wall Tile",
  "wall-wood-panel":  "Wood Veneer Panel",
  "wall-tile-metro":  "Metro Tile (Bath/Kitchen)",
  "wall-emerald-tile":"Emerald Art Tile",
  // Floor
  "floor-oak":        "Natural Oak Flooring",
  "floor-walnut":     "Dark Walnut Flooring",
  "floor-white-tile": "White Polished Tile",
  "floor-herringbone":"Herringbone Parquet Floor",
  "floor-concrete":   "Concrete Gray Tile",
  "floor-bamboo":     "Carbonized Bamboo Flooring",
  "floor-black-tile": "Matte Black Stone Tile",
  "floor-hex-white":  "White Hexagonal Tile",
  "floor-terracotta": "Handmade Terracotta Tile",
  // Light
  "light-spot":               "LED Track Spotlight",
  "light-pendant-nordic":     "Nordic Globe Pendant",
  "light-chandelier":         "Crystal Chandelier",
  "light-japanese-paper":     "Washi Paper Pendant",
  "light-linear-pendant":     "Linear Pendant Light",
  "light-industrial-bulb":    "Industrial Edison Bulb",
  "light-ceiling-fan":        "Ceiling Fan with Light",
  "light-ring-modern":        "Modern Ring Pendant",
  "light-crystal-chandelier": "Crystal Chandelier (Large)",
  "light-magnetic-track":     "Magnetic Track Lighting",
  "light-smart-panel":        "Smart Ceiling Panel",
  "light-recessed":           "Recessed Downlights (Set)",
  // Tile
  "tile-white-marble":  "White Marble Tile",
  "tile-gray-stone":    "Gray Stone Tile",
  "tile-terracotta":    "Vintage Floor Tile",
};

export const BRAND_NAMES_EN: Record<string, string> = {
  // Material brands
  "水性内墙漆":   "Water-Based Paint",
  "进口乳胶漆":   "Latex Paint",
  "净味乳胶漆":   "Low-VOC Paint",
  "立邦":         "Interior Paint",
  "釉面砖":       "Glazed Tile",
  "强化复合地板": "Laminate Flooring",
  "全抛釉砖":     "Full-Polish Tile",
  "通体砖":       "Through-Body Tile",
  "实木复合地板": "Engineered Hardwood",
  "竹木地板":     "Bamboo Flooring",
  "LED轨道灯":    "LED Track",
  "北欧吊灯":     "Nordic Pendant",
  "水晶吊灯":     "Crystal Light",
  "和纸纸灯":     "Paper Lantern",
  "线型灯具":     "Linear Light",
  "复古钨丝灯":   "Vintage Filament",
  // Furniture brands
  "北欧家居":     "Nordic Living",
  "功能沙发":     "Function Sofa",
  "现代家居":     "Modern Living",
  "日式家居":     "Japan Style",
  "实木家居":     "Solid Wood",
  "品牌家居":     "Premium Home",
  "板式家居":     "Panel Furniture",
  "北欧灯具":     "Nordic Lighting",
  "国产灯具":     "Domestic Lighting",
  "绿植优选":     "Plant Studio",
  "地毯工坊":     "Rug Studio",
  "东方织造":     "Oriental Textile",
  "艺术工坊":     "Art Workshop",
  "文房四宝":     "Study Arts",
  "定制衣柜":     "Custom Wardrobe",
  "设计师家具":   "Designer Furniture",
  "定制橱柜":     "Custom Cabinet",
  "对开门冰箱":   "French Door Fridge",
  "家用冰箱":     "Home Fridge",
  "侧吸油烟机":   "Side-Draft Hood",
  "厨房水槽":     "Kitchen Sink",
  "卫浴洁具":     "Bathroom Fixtures",
  "日式洁具":     "Japanese Fixtures",
  "整体淋浴房":   "Shower Enclosure",
  "乐歌":         "Adjustable Desk",
  "西昊":         "Ergonomic Chair",
  "园艺优选":     "Garden Select",
  "景观石材":     "Landscape Stone",
  "景观木业":     "Landscape Wood",
  "景观五金":     "Landscape Hardware",
  "户外生活":     "Outdoor Living",
  "水景专家":     "Water Feature",
  "景观建构":     "Landscape Build",
  "户外运动":     "Outdoor Sports",
  "宠物":         "Pet",
  "宠物用品":     "Pet Supplies",
  "散养":         "Free-Range",
  "农场":         "Farm",
  "自定义":       "Custom",

  // Additional brands seen on new assets (lights / fixtures / plumbing / decor)
  "照明":         "Lighting",
  "五金":         "Hardware",
  "陶瓷":         "Ceramic",
  "装饰":         "Decor",
  "定制":         "Custom-Made",
  "美的":         "Midea",
  "园艺":         "Garden",
  "电工":         "Electrical",
  "家用电器":     "Appliance",
  "灯饰":         "Lighting",
};

export function getFurnitureNameEn(id: string): string | undefined {
  return FURNITURE_NAMES_EN[id];
}

export function getMaterialNameEn(id: string): string | undefined {
  return MATERIAL_NAMES_EN[id];
}

export function getBrandNameEn(brand: string): string {
  return BRAND_NAMES_EN[brand] ?? brand;
}

/** Clearance-rule rationale translations. Keyed on the exact Chinese
 *  string from src/lib/clearance.ts. Component looks this up when
 *  locale === "en". If an entry is missing, falls back to Chinese. */
export const CLEARANCE_REASON_EN: Record<string, string> = {
  "沙发前留 40cm 给茶几，侧面 10cm 不憋屈": "Leave 40cm in front for coffee table, 10cm on sides",
  "茶几四周 30cm 方便绕行": "Leave 30cm around coffee table for walking around",
  "电视柜建议贴墙，便于走线+避免跌倒": "TV unit should hug the wall — easier cabling, less tipping risk",
  "电视柜前留 5cm 布线空间": "Leave 5cm behind TV unit for cabling",
  "书柜独立摆放有倾倒风险，建议贴墙或打膨胀螺丝固定": "Free-standing bookshelf is a tipping hazard — anchor to the wall",
  "书柜前留 60cm 取书空间": "Leave 60cm in front of bookshelf for reaching books",
  "边柜建议贴墙，节省空间且更稳": "Sideboard should hug wall — saves space and is more stable",
  "边柜前留 60cm 开抽屉": "Leave 60cm in front of sideboard for drawers",
  "床头建议靠墙，有靠背更安心（风水与功能兼顾）": "Headboard should hug wall — both feng shui and safety",
  "床两侧/床尾留 60cm 过道+铺床": "Leave 60cm around bed for walking + making the bed",
  "床头柜紧贴床，预留 5cm 调整空间": "Nightstand right next to bed — leave 5cm slack",
  "衣柜独立摆放易倾倒（危险！），必须贴墙或打膨胀螺丝": "Free-standing wardrobe tips over easily — must anchor to wall",
  "衣柜前留 75cm 开门+站人": "Leave 75cm in front of wardrobe for door + standing",
  "梳妆台建议贴墙，镜面更稳定": "Vanity should hug wall — more stable mirror",
  "梳妆台前留 75cm 坐凳": "Leave 75cm in front of vanity for the stool",
  "餐桌四周 75cm 拉开椅子+走动": "Leave 75cm around dining table for chairs + walking",
  "橱柜须贴墙安装": "Kitchen cabinets must be wall-mounted",
  "橱柜前留 90cm 操作+开门": "Leave 90cm in front of cabinets for working + doors",
  "冰箱建议贴墙（散热留 5-10cm），独立摆放浪费空间": "Fridge should hug wall (leave 5-10cm for airflow)",
  "冰箱前留 90cm 开门取物+散热": "Leave 90cm in front of fridge for door + ventilation",
  "油烟机须贴墙（与灶台对齐）": "Range hood must hug the wall (aligned with cooktop)",
  "水槽须嵌入橱柜、贴墙安装": "Sink must be flush-mounted in cabinets, against wall",
  "水槽前留 80cm 洗涮站位": "Leave 80cm in front of sink for standing",
  "马桶须贴墙（下水管位置固定）": "Toilet must hug wall (drain pipe is fixed)",
  "马桶前留 50cm，两侧 20cm": "Leave 50cm in front of toilet, 20cm on sides",
  "浴缸前留 60cm 进出+擦身": "Leave 60cm in front of bathtub for getting in/out",
  "淋浴房前留 60cm 进出": "Leave 60cm in front of shower for access",
  "洗手台须贴墙（上下水管位置固定）": "Vanity must hug wall (water pipes are fixed)",
  "洗手台前留 75cm 弯腰+站立": "Leave 75cm in front of vanity for bending + standing",
  "书桌前留 75cm 椅子+坐位": "Leave 75cm in front of desk for chair + seat",
  "储物柜建议贴墙，节省空间+更稳": "Storage cabinet should hug wall — saves space, more stable",
  "书桌距窗户过远（建议 ≤2m），白天读写需开灯，长期用眼疲劳": "Desk too far from window (keep ≤2m) — daytime reading needs light, causes eye strain",
  "阻挡门开合，门可能撞到家具": "Blocks door swing — the door may hit furniture",
  "家具高于窗台且位于窗前，遮挡采光与通风": "Furniture taller than sill blocks light and ventilation",
};

export function translateClearanceReason(zh: string, locale: string): string {
  if (locale !== "en" || !zh) return zh;
  return CLEARANCE_REASON_EN[zh] ?? zh;
}
