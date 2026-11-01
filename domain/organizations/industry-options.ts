/** Valores estables para segmentar organizaciones y aportar contexto a futuras funciones de IA. */
export const INDUSTRY_OPTIONS = [
  { value: 'technology', label: 'Tecnología' },
  { value: 'healthcare', label: 'Salud' },
  { value: 'education', label: 'Educación' },
  { value: 'retail', label: 'Comercio y retail' },
  { value: 'manufacturing', label: 'Manufactura e industria' },
  { value: 'professional_services', label: 'Servicios profesionales' },
  { value: 'finance_insurance', label: 'Finanzas y seguros' },
  { value: 'construction_real_estate', label: 'Construcción e inmobiliaria' },
  { value: 'transport_logistics', label: 'Transporte y logística' },
  { value: 'energy_utilities', label: 'Energía y servicios públicos' },
  { value: 'agriculture', label: 'Agricultura y ganadería' },
  { value: 'hospitality_tourism', label: 'Turismo y hotelería' },
  { value: 'media_telecommunications', label: 'Medios y telecomunicaciones' },
  { value: 'public_sector', label: 'Sector público' },
  { value: 'nonprofit', label: 'Organizaciones sin fines de lucro' },
  { value: 'other', label: 'Otro' },
] as const

export const INDUSTRY_VALUES = INDUSTRY_OPTIONS.map(option => option.value) as [
  (typeof INDUSTRY_OPTIONS)[number]['value'],
  ...(typeof INDUSTRY_OPTIONS)[number]['value'][],
]
