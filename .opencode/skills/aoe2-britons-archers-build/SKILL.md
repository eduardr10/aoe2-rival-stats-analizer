---
name: aoe2-britons-archers-build
description: "Optimized 22-pop archer build order for Britons in Age of Empires II: Definitive Edition, covering Dark Age economy, Feudal transition, Castle Age crossbow timing, and counter-adaptations per opposing civ."
license: MIT
metadata:
  author: ai-video-analyst
  version: "2.0"
---

# Britons Archer Build Order

Professional 22-pop archer build for the Britons civilization on Arabia (1v1). Leverages the sheep-gathering bonus to reach Castle Age with ~14 crossbows and +2 attack before the opponent stabilizes.

## Overview / Resumen

**Goal**: Feudal archer pressure → Castle Age crossbow power spike at ~14:00 with +2 attack researched.

**Core idea**: Britons gather sheep 25% faster, which lets you sustain villager production from fewer shepherds. Reallocate those villagers to wood/early farms sooner, giving you a faster Castle Age while maintaining archer production.

**Target audience**: 1300-1800 Elo 1v1 Arabia players who want a reliable, repetition-friendly archer build.

## Requisitos previos

| Requisito | Detalle |
|---|---|
| Game version | Age of Empires II: Definitive Edition (current patch) |
| Civilization | Britons |
| Map | Arabia (open map) |
| Game mode | 1v1 Random Map |
| Villager gather point | Always set to the resource you will need next, not left on a resource that is saturated |

## Flujo de trabajo

### Dark Age (22 pop — 21 villagers + loom)

| Población | Acción | Recurso asignado | Nota |
|---|---|---|---|
| 1–3 | Crear aldeanos → Ovejas | 3 ovejas | Britons bonus: 3 pastores bastan donde otras civs necesitan 4 |
| 4–6 | Leña — 1er Lumber Camp | 3 leña | Construir el LC cerca del bosque, 1 tile de separación para muros |
| 7–8 | Leña — 2do aldeano al LC | 4 leña | Mantener 4 en leña hasta transición |
| 9 | Recoger oveja del centro | Ovejas | 4 pastores |
| 10 | Explorar con scout | — | Buscar los 2 jabalíes y ovejas restantes |
| 11 | Jabalí 1 (lure ~1:30–1:45) | Ovejas → Jabalí | 6-7 aldeanos en jabalí, 4 en ovejas |
| 12 | Leña | 5 leña | |
| 13–14 | Ovejas / Jabalí 2 | 7-8 comida | Segundo jabalí ~3:00 |
| 15–17 | 3 casas + Molino | — | Molino a 1 tile de distancia de bayas |
| 18–20 | Bayas (3) + Oro (1) | 4 bayas, 1 oro | |
| 21 | Loom + Feudal click | — | Click Feudal ~3:50–4:00 |

**Timestamps clave**: Loom ~3:45, Feudal click ~3:55, Feudal arrival ~5:45.

### Feudal Age — Transición económica

```text
ALDEANOS AL LLEGAR A FEUDAL (momento exacto):
  Leña:  5 → +3 (total 8)
  Oro:   1 → +1 (total 2)
  Bayas: 4 (se mantienen)
  Ovejas:  3 → 0 (se recolocan en leña/granjas)
  Jabalí:  5 → 3 se van a granjas, 2 a leña

TOTAL: 8 leña, 4 bayas, 2 oro, resto a comida (granjas)
```

| Paso | Tiempo estimado | Acción |
|---|---|---|
| 1 | Feudal click (~3:55) | Recolocar 3 pastores a leña (total 8) |
| 2 | Feudal click | Añadir 1 aldeano a oro (total 2) |
| 3 | 50% transición (~4:35) | Construir Barracks |
| 4 | Al llegar (~5:45) | Construir Archery Range + research Double-Bit Axe |
| 5 | +30s (~6:15) | Empezar producción de archers (1 range, constante) |
| 6 | Durante Feudal | Llegar a 13 granjas. NO investigar Horse Collar |
| 7 | Mientras acumulas | Añadir 2º Archery Range si el rival va muy defensivo |

**Distribución estable en Feudal (~6:30–9:00):**

```
Leña:   8-10   (para granjas + ranges)
Comida: 13-15  (granjas + caza residual si hay)
Oro:    4      (suficiente para archers + upgrades)
Bayas:  4      (se dejan secar gradualmente → leña)
Piedra: 0      (no aplicar a Towers ni Castles con esta build)
```

**Producción de archers:** 1 Archery Range constante. Llegar a 12-14 archers antes de subir a Castle.

### Castle Age — Timing principal

| Paso | Tiempo | Acción |
|---|---|---|
| 1 | ~8:30 | TC gather point → Oro (total 6-8 oro) |
| 2 | ~9:00 | Construir Blacksmith |
| 3 | ~10:30–10:45 | Click Castle Age (14 archers, 13 granjas) |
| 4 | ~12:15–12:45 | Al llegar: Crossbowman + +2 Attack (simultáneo) |
| 5 | ~13:00 | Atacar con toda la masa |
| 6 | ~13:30 | Body Block (tower/TC de rival) con archers |
| 7 | ~14:00 | 3er Archery Range, empezar Thumb Ring |

> ⚠️ **Importante**: No peleéis en Feudal salvo para defender vuestra base. La fuerza de esta build es el timing de Castle; desperdiciar archers en Feudal erosiona la masa crítica.

### Mapa de decisiones

```text
¿Rival hace Scouts?
│
├─ Sí → Construir 1-3 Spearmen. Proteger linea de leña.
│       Mantener archers en base. Esperar Castle.
│       Si hay ->2 Scouts en tu eco, pausar arqueros y hacer +2 pikas.
│
├─ No, hace Archers →
│       Espejo. Llegar a Castle primero gana.
│       Acumular +2 archers que el rival. +2 Attack decide la pelea.
│
├─ No, hace Towers →
│       Mover archers a gold/wood alternativo.
│       1-2 Spearmen para defender villagers que repelen torres.
│       Llegar a Castle rápido. +2 Attack derriba torres.
│
└─ No, va Fast Castle →
        Presionar con archers en Feudal (no esperar Castle).
        Evitar que construya establos/monasterio sin pagar.
```

## Counter-adaptations por civ rival

| Civ rival | Ajuste a la build | Prioridad en Castle |
|---|---|---|
| Franks (Scout + Knight) | +2 Spearmen en Feudal, +1 Monk en Castle | +2 Attack, luego +2 Armor |
| Mongols (drush + mangudai) | Muros en Feudal, +1 Spearmen | Crossbow, luego Thumb Ring |
| Aztecs (Monk + Eagle) | No sobreinvertir en archers; +2 Monks propios | +1 Armor, +2 Attack |
| Mayans (Archer mirror) | +1 Archery Range extra, pelear por Xbow primero | +2 Attack + Thumb Ring simultáneo |
| Chinese (archers + eco) | Asumir que llegan a Castle antes; defensivo | +2 Attack, hacer Bodkin + +1 Armor |
| Huns (Cav archer + Knight) | Muros en Feudal, +1 Stable propietario en Castle | +2 Attack, Light Cavalry |
| Byzantines (Counter units) | No comprometerse; +2 Monks | +2 Attack, +1 Armor, luego +2 Armor |

## Uso de la ventaja de Britons (Sheep bonus)

El bonus de pastoreo 25% más rápido permite:

1. **Menos pastores**: 3 pastores Britons = 4 pastores de cualquier otra civ. Esos 2 aldeanos extra van a leña o granjas antes.
2. **Mejor transición**: Llegas a 13 granjas ~30s antes que un archer build estándar.
3. **Feudal más estable**: Puedes permitirte construir el Archery Range y el Blacksmith sin sacrificar producción de aldeanos.
4. **Margen de error**: Si pierdes un jabalí, el bonus de oveja compensa parte de la pérdida.

## Tabla de distribución económica (por edad)

| Edad | Leña | Comida | Oro | Piedra | Total aldeanos |
|---|---|---|---|---|---|
| Dark (22 pop) | 5 | 11 (4 ovejas, 5 jabalí, 2 bayas) | 1 | 0 | 17 eco |
| Feudal inicio | 8 | 13 (4 bayas, 9 granjas) | 2 | 0 | 23 |
| Feudal medio | 10 | 13 (13 granjas) | 4 | 0 | 27 |
| Castle inicio | 10 | 13 (granjas estables) | 8 | 0 | 31+ |
| Castle medio | 10 | 20 (expandir granjas) | 10 | 2 (si Castle) | 40+ |

## Errores comunes y diagnóstico

| Síntoma | Causa raíz | Corrección |
|---|---|---|
| Idle TC en Dark (~10s+) | Recolocar ovejas/jabalí muy tarde | TC gather point → oveja al empezar partida. Lure jabalí a los 1:45 |
| Sin madera a los ~6:00 | Solo 5-6 en leña en Dark | Mantener 5 en leña mínimo durante Dark Age |
| Llegas a Castle sin 13 granjas | Pusiste gather point en oro muy tarde | Marcar gather point → oro a los ~8:30 |
| Archers mueren en Feudal | Dejaste que el rival hiciera contacto sin escudos | 1-2 Spearmen preventivos |
| Llegas a Castle a las 13:00+ | Idle TC o muy pocos en comida | Debes tener 13 granjas + bayas funcionando a los 9:00 |
| Sin oro al llegar a Castle | Demasiado tarde en mover gather point | Gather point a oro a los 8:30, no esperar a click Castle |

## Mejores prácticas

**Macro:**
- No investigar Horse Collar en Feudal temprano — 150 madera = 3 granjas en este momento de la partida. Horse Collar se investiga en Castle cuando renueves granjas.
- Muros: Colocar mills/lumber camps a 1 tile del recurso para dejar espacio para palisade walls. Muro en Feudal protege tu archer mass.
- Siempre mantener scout vivo — saber qué hace el rival determina si necesitas Spearmen o más archers.

**Micro:**
- Archers parados > archers moviéndose. Si no hay pelea, ponlos en stand ground cerca de tu base.
- Split al pelear contra mangoneles — seleccionar mitad + clic en dirección opuesta.
- Body block con archers (stand ground + patrol) para atrapar villagers que reparan.

**Opciones avanzadas:**
- Si el rival va a Castle muy rápido (monks): añadir 1 Scout propio para matar monks.
- Si el mapa es cerrado (Arena, Black Forest): ajustar a 26+2, más granjas antes de ranges.
- Si vas muy por detrás en eco: skip el +2 Attack inicial, ir directo a Thumb Ring (más barato).

## Variaciones de la build

### 21-pop (más agresivo, menos seguro)

```
Sacrificar 1 aldeano de bayas → 20 vill + loom → Feudal ~3:35
Ventaja: Castle ~11:45 (45s antes)
Riesgo: Eco más justa. No da margen si pierdes jabalí.
```

### 23-pop (más seguro, contra drush)

```
Añadir 1 aldeano extra a leña en Dark → 22 vill + loom → Feudal ~4:10
Ventaja: Castle ~12:30 pero eco más sólida.
Uso: Cuando sabes que viene drush (Mongols, Aztecs, Mayans).
```

### M@a (Men-at-Arms) opening

```
En lugar de archers directos: 3 M@a en Feudal → después ranges.
No recomendado con Britons (no tienen bonus M@a).
Solo si scout revela que el rival no tiene muros.
```

## Verificación

```text
CHECKLIST — Ejecución correcta:

[ ] Feudal click entre 3:45–4:15 (22 pop)
[ ] Castle click entre 10:15–11:00
[ ] 13+ granjas ANTES de click Castle
[ ] Double-Bit Axe investigado antes del primer archer
[ ] Mínimo 12 archers al llegar a Castle
[ ] Crossbowman + +2 Attack investigados <30s tras llegar a Castle
[ ] Primer ataque con crossbows entre 13:00–14:30
[ ] Idle TC <15s acumulado total
```

**Comando para autoverificación** (en análisis post-partida — Capture Age / AoE2 Insights):

```text
1. Abrir el timeline del juego.
2. Verificar: tiempo de Feudal, Castle, y número de granjas al click Castle.
3. Buscar: si Horse Collar se investigó antes de Castle → ❌ error.
4. Contar: archers producidos antes de Castle → si <12 → ❌ necesitas más ranges o menos idling.
```

## Referencias

- [AoE2 Companion Build Orders](https://aoe2companion.com/build-orders)
- [Spirit of the Law — Britons guide](https://www.youtube.com/@SpiritoftheLaw)
- [Hera's Britons Archer Build (video)](https://www.youtube.com/watch?v=z5Ci3NH7pYY)
- [AoE2 Insights — Build Order Analyzer](https://aoe2insights.com)
- [Liquipedia Britons page](https://liquipedia.net/ageofempires/Britons)
- [Capture Age replay viewer](https://capture-age.com)
