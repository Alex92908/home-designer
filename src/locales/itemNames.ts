// English names for furniture and material items keyed by item ID
// Falls back to item.name if ID not found

export const FURNITURE_NAMES_EN: Record<string, string> = {
  // Sofa
  "sofa-fabric-gray":       "Fabric 3-Seat Sofa",
  "sofa-leather-brown":     "L-Shaped Leather Sofa",
  "sofa-nordic-blue":       "Nordic Velvet Sofa",
  "sofa-japanese":          "Legless Tatami Sofa",
  "sofa-modular-green":     "Modular Corner Sofa",
  // Coffee Table
  "coffee-oak-round":       "Oak Round Coffee Table",
  "coffee-marble-rect":     "Marble Square Coffee Table",
  "coffee-glass-black":     "Glass & Iron Coffee Table",
  // TV Unit
  "tvunit-float-white":     "Floating TV Unit (White)",
  "tvunit-walnut":          "Solid Wood TV Unit (Walnut)",
  "tvunit-black-stone":     "Black Sintered Stone TV Unit",
  // Floor Lamp
  "lamp-arc-gold":          "Nordic Arch Floor Lamp",
  "lamp-industrial-black":  "Industrial Iron Floor Lamp",
  // Bookshelf
  "shelf-open-white":       "Open Bookshelf (White)",
  "shelf-wood-walnut":      "Solid Wood Bookshelf (Walnut)",
  // Sideboard
  "sideboard-entry":        "Solid Wood Entryway Cabinet",
  "side-table-modern":      "Modern Side Table",
  // Plants
  "plant-monstera":         "Large Monstera",
  "plant-snake":            "Snake Plant",
  "plant-rubber":           "Rubber Tree",
  "plant-balcony":          "Balcony Planter Combo",
  // Rug
  "rug-nordic":             "Nordic Geometric Rug",
  "rug-modern":             "Modern Minimalist Rug",
  "rug-persian":            "Persian Style Rug",
  // Artwork
  "art-abstract":           "Abstract Modern Artwork",
  "art-ink":                "Landscape Ink Painting",
  // Bed
  "bed-fabric-cream":       "Fabric Upholstered Bed (Cream)",
  "bed-leather-brown":      "Leather Bed (Dark Brown)",
  "bed-nordic":             "Nordic Wood Bed",
  "bed-tatami":             "Tatami Low Bed",
  "bed-single":             "Single Bed (White)",
  // Nightstand
  "ns-modern-white":        "Modern Nightstand (White)",
  "ns-wood":                "Solid Wood Nightstand",
  // Wardrobe
  "wardrobe-sliding-white": "Sliding Door Wardrobe (White)",
  "wardrobe-wood-walnut":   "Solid Wood Wardrobe (Walnut)",
  "wardrobe-rack":          "Open Coat Rack",
  // Dresser
  "dresser-nordic":         "Nordic Vanity Table",
  // Walk-in Closet
  "wic-system":             "Walk-in Closet System",
  "wic-island":             "Walk-in Closet Island",
  // Dining Table
  "dt-marble-round":        "Marble Round Dining Table",
  "dt-oak-rect":            "Oak Rectangular Dining Table",
  "dt-stone-black":         "Black Sintered Stone Dining Table",
  // Dining Chair
  "dc-nordic-wood":         "Nordic Wood Dining Chair",
  "dc-leather-modern":      "Modern Leather Dining Chair",
  "dc-iron":                "Iron Dining Chair",
  // Kitchen Cabinet
  "kc-lower-white":         "Kitchen Lower Cabinet (White)",
  "kc-lower-gray":          "Kitchen Lower Cabinet (Gray)",
  "kc-upper-white":         "Kitchen Upper Cabinet (White)",
  // Kitchen Appliances
  "fridge-french-door":     "French Door Refrigerator",
  "fridge-single":          "Single Door Refrigerator",
  "rh-side-draft":          "Side-Draft Range Hood",
  "ks-double-sink":         "Double-Basin Stainless Steel Sink",
  // Toilet
  "wc-smart":               "Smart Integrated Toilet",
  "wc-siphon":              "Siphon Toilet",
  "wc-wall":                "Wall-Hung Toilet",
  // Bathtub & Shower
  "bath-freestanding":      "Freestanding Bathtub",
  "bath-builtin":           "Built-in Bathtub",
  "shower-enclosed":        "Enclosed Shower Unit",
  "shower-frameless":       "Frameless Shower Area",
  // Bathroom Vanity
  "vanity-single":          "Single-Basin Bathroom Vanity",
  "vanity-double":          "Double-Basin Stone Vanity",
  // Desk
  "desk-nordic":            "Nordic Solid Wood Desk",
  "desk-l-shape-white":     "L-Shaped Desk",
  "desk-standing":          "Electric Height-Adjustable Desk",
  // Office Chair
  "chair-ergonomic":        "Ergonomic Office Chair",
  "chair-simple-fabric":    "Simple Fabric Office Chair",
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
