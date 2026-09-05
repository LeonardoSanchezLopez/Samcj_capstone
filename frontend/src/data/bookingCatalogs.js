export const districtGroups = [
  {
    label: 'Distritos y sectores atendidos',
    options: [
      'Alto Trujillo',
      'El Porvenir',
      'Florencia de Mora',
      'Huanchaco',
      'La Esperanza',
      'Laredo',
      'Moche',
      'Salaverry',
      'Trujillo',
      'Víctor Larco Herrera'
    ]
  },
  {
    label: 'Urbanizaciones y zonas de Trujillo',
    options: [
      'Chicago',
      'Daniel Hoyle',
      'El Bosque',
      'El Recreo',
      'La Merced',
      'Las Quintanas',
      'Los Granados',
      'Los Pinos',
      'Miraflores',
      'Monserrate',
      'Palermo',
      'Pesqueda',
      'Primavera',
      'San Andrés',
      'San Isidro',
      'Santa Inés',
      'Santo Dominguito'
    ]
  }
];

export const dealershipBrands = {
  'Automotores Inka': ['Mazda', 'Renault', 'Subaru', 'Hyundai', 'JAC', 'DFSK', 'Great Wall', 'BYD', 'Changan', 'Fuso', 'Suzuki'],
  'Autonort': ['Toyota'],
  'Derco Center': ['Suzuki', 'Changan', 'Mazda', 'Renault', 'JAC', 'GWM', 'Haval', 'Citroën'],
  'Intermotors': ['Kia', 'Mitsubishi', 'Chery', 'MG', 'Peugeot', 'Jetour']
};

export const vehicleCatalog = {
  SEDAN: {
    Toyota: ['Yaris', 'Corolla Hybrid'],
    Hyundai: ['Grand i10 Sedan', 'Accent'],
    Kia: ['Soluto', 'K3'],
    Nissan: ['Versa', 'Sentra'],
    Chevrolet: ['Sail Sedán'],
    Suzuki: ['Dzire Smart Hybrid'],
    Mazda: ['Mazda 3 Sedán'],
    Volkswagen: ['Jetta', 'Virtus'],
    'Otra marca': ['Otro / No aparece en la lista']
  },
  SUV_HATCHBACK: {
    Toyota: ['Agya', 'Raize', 'Rush', 'Yaris Cross', 'Corolla Cross', 'RAV4', 'Fortuner', '4Runner', 'Land Cruiser Prado'],
    Hyundai: ['Grand i10 Hatch', 'i20 Hatch', 'Venue', 'Creta', 'Creta Grand', 'Tucson', 'Tucson Hybrid', 'Santa Fe', 'Palisade'],
    Kia: ['Picanto', 'K3 Cross', 'Sonet', 'Seltos', 'Sportage', 'Carens', 'Sorento'],
    Nissan: ['Kicks', 'Kicks Play', 'X-Trail', 'Pathfinder'],
    Chevrolet: ['Groove', 'Tracker', 'Captiva XL', 'Traverse', 'Tahoe'],
    Ford: ['Territory', 'Bronco Sport', 'Explorer', 'Expedition', 'Bronco'],
    Suzuki: ['Baleno', 'Celerio', 'Swift Smart Hybrid', 'Alto', 'S-Presso', 'Fronx Smart Hybrid', 'XL7 Smart Hybrid', 'Jimny'],
    Mazda: ['Mazda 3 Sport', 'CX-3', 'CX-30', 'CX-5', 'CX-60', 'CX-90'],
    Volkswagen: ['Polo', 'Tera', 'Nivus', 'T-Cross', 'Taos', 'Tiguan', 'Teramont'],
    'Otra marca': ['Otro / No aparece en la lista']
  },
  CAMIONETA_PICKUP: {
    Toyota: ['Hilux', 'Hilux GR Sport', 'Hiace', 'Avanza'],
    Ford: ['Maverick', 'Ranger', 'Ranger Raptor', 'F-150'],
    Nissan: ['Frontier', 'Urvan'],
    Chevrolet: ['Montana', 'Colorado', 'Silverado', 'Suburban'],
    Hyundai: ['H-100', 'Staria Minibús'],
    Kia: ['Tasman', 'Towner'],
    Suzuki: ['APV Van', 'APV Furgón'],
    Mazda: ['BT-50'],
    Volkswagen: ['Amarok', 'Saveiro'],
    'Otra marca': ['Otro / No aparece en la lista']
  }
};

export const vehicleYears = Array.from(
  { length: (new Date().getFullYear() + 1) - 1980 + 1 },
  (_, index) => (new Date().getFullYear() + 1) - index
);
