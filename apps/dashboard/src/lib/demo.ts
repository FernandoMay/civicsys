export function ci() {
  return {
    metrics: {
      initiatives: 14,
      neighbors: 4892,
      decisions: 38,
      audit: "100%",
    },
  };
}

export function proposalDemo(index: number) {
  return {
    id: index + 1,
    headline: [
      "Corredor de Movilidad Eléctrica y Estaciones Solares (Av. San Juan)",
      "Red de Energía Solar para el Centro de Salud Santa Teresa y 3 Escuelas",
      "Revitalización Participativa del Parque Central y Drenaje Sostenible",
    ][index] ?? "",
  };
}
