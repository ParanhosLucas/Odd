// Dados fictícios para desenvolver a interface sem depender do Betano.
const LEAGUES = [
  { name: "Brasil - Brasileirão Série A", games: [["Flamengo", "Palmeiras", 2.1, 3.3, 3.4], ["Corinthians", "São Paulo", 2.6, 3.0, 2.8], ["Grêmio", "Internacional", 2.4, 3.2, 2.95], ["Botafogo", "Fluminense", 2.0, 3.4, 3.6]] },
  { name: "Inglaterra - Premier League", games: [["Arsenal", "Chelsea", 1.85, 3.7, 4.2], ["Liverpool", "Man City", 2.7, 3.6, 2.5], ["Tottenham", "Newcastle", 2.3, 3.5, 3.1]] },
  { name: "Espanha - La Liga", games: [["Real Madrid", "Barcelona", 2.35, 3.6, 2.9], ["Atlético Madrid", "Sevilla", 1.7, 3.6, 5.0]] },
];

const jitter = (v) => Math.max(1.01, +(v * (1 + (Math.random() - 0.5) * 0.04)).toFixed(2));

export async function fetchDemo() {
  const base = Date.now();
  let n = 0;
  return LEAGUES.map((l) => ({
    name: l.name,
    matches: l.games.map(([home, away, h, d, a]) => ({
      id: `demo-${n}`,
      home, away,
      startTime: new Date(base + (++n) * 3600_000).toISOString(),
      live: false,
      odds: { home: jitter(h), draw: jitter(d), away: jitter(a) },
    })),
  }));
}
