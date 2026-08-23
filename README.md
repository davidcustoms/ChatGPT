# ChatGPT

This repository holds two independent projects.

## [`qbo-cfo/`](./qbo-cfo) — QuickBooks Online Monthly CFO Reporting Agent

A read-only financial intelligence layer for a multi-location retail business.
It connects to QuickBooks Online over the official Intuit API, stores monthly
snapshots, computes metrics and anomalies deterministically, and produces a
polished monthly CFO report with PDF and Excel export, a store-performance
dashboard, and a natural-language interface over the accounting data.

```bash
cd qbo-cfo
npm install
cp .env.example .env.local
npm run db:migrate
npm run db:seed-demo     # optional: 24 months of synthetic demo data
npm run dev
```

See [`qbo-cfo/README.md`](./qbo-cfo/README.md) for full documentation.

> The application never writes to QuickBooks. QuickBooks remains the system of
> record.

## [`chronoquest-slot/`](./chronoquest-slot) — ChronoQuest: Team Showdown

A free-play slot machine demo (Phaser + TypeScript + Vite).

```bash
cd chronoquest-slot
npm install
npm run dev
```

See [`chronoquest-slot/README.md`](./chronoquest-slot/README.md) for full docs.

> Free-play demo only — fake credits, not real-money gambling.

## [`trade-alpha-prompt.md`](./trade-alpha-prompt.md)

A trading-analyst system prompt.
