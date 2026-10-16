// Real-sensor placement by soil and plant kind for the Digital Twin site. Used by
// audit_sensor_count.mjs ("حسب التربة والنبات").
//
// Greedy order over the section templates. Each step adds the section whose soil
// kind has the fewest real sensors so far, so every soil kind gets one before any
// gets a second; among those, the section whose plant kind has the fewest real
// sensors, so plant kinds are covered as far as the soil rule allows. Ties go to
// the larger area, then the lower index. The first N ids are the placement for N.
export function soilPlantOrder(templates) {
  const soilCount = new Map();
  const plantCount = new Map();
  const left = templates.map((t, index) => ({ ...t, index }));
  const order = [];
  while (left.length) {
    const key = (t) => [soilCount.get(t.soil) || 0, plantCount.get(t.plant) || 0, -t.areaM2, t.index];
    left.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      return 0;
    });
    const t = left.shift();
    order.push(t.id);
    soilCount.set(t.soil, (soilCount.get(t.soil) || 0) + 1);
    plantCount.set(t.plant, (plantCount.get(t.plant) || 0) + 1);
  }
  return order;
}
