# AGENTS.md

Agent configuration and process rules for this repository. Companion to the
"AI usage" section of `README.md`.

## Tooling

| Tool                | Role                                                         |
| ------------------- | ------------------------------------------------------------ |
| Claude Code (Opus)  | Primary assistant: implementation, refactoring, tests        |
| Angular MCP server  | Source of truth for current Angular APIs and best practices  |
| `.claude/CLAUDE.md` | Binding coding rules the agent must follow (Angular/TS/a11y) |
| `CLAUDE.md` (root)  | Repository orientation: commands, architecture, constraints  |

The Angular MCP server is consulted before writing Angular code rather than
relying on the model's training data. This project targets Angular 22, where
several defaults changed recently (zoneless by default, `OnPush` by default,
Signal Forms stable, `@Service` decorator) — exactly the area where a model's
priors are most likely to be stale.

## Division of labour

**Delegated to the agent**

- Scaffolding components, services and their specs from an agreed design.
- Mechanical translation work: GBFS payload shapes → `Vehicle` domain model.
- Test authoring for the mapper, polling and store.
- Documentation drafting, including this file.
- Endpoint reconnaissance: querying the live feeds and summarising their schema,
  volume and headers.

**Retained by the developer**

- Architecture: the layer boundaries in `README.md` were specified up front and
  the agent implements within them, not around them.
- Every decision recorded under "Decisions and trade-offs".
- Accepting or rejecting each diff. Several agent proposals were rejected —
  see "Reviewed and overruled" below.
- Commit granularity and messages.

## Process rules

1. **Spec first.** `README.md` is the design contract. Code that contradicts it
   is a bug in the code, not a new design.
2. **Verify claims against reality.** Any assertion about an external feed must
   come from an actual request, not from documentation or model recall. The
   empty Citi Bike feed was caught this way.
3. **No unreviewed diffs.** Every change is read before commit. `npm ci &&
ng build` must pass.
4. **English in code and commits**, regardless of the language of the
   conversation that produced them.
5. **Small, milestone-separated commits.** The initial commit is the untouched
   Angular CLI scaffold; every subsequent commit is a reviewable step.

## Reviewed and overruled

Recording these because "the agent suggested it" is not a reason to ship
something, and the review trail is the point.

- **Removing the `OnPush` label from the architecture diagram.** The agent
  proposed it on the grounds that `.claude/CLAUDE.md` forbids declaring
  `changeDetection` explicitly in Angular 22. Rejected: the rule is about the
  decorator, not about documenting the behaviour. Components _are_ `OnPush`;
  saying so in the README is accurate and useful. The README now states both the
  behaviour and why it is not declared in code.
- **Trusting the brief's endpoint.** The initial plan assumed the specified Citi
  Bike feed carried data. Querying it showed `{"bikes": []}`, which changed the
  provider choice and hardened the case for the mapper boundary.

## Known agent failure modes in this repo

- Proposing `changeDetection: ChangeDetectionStrategy.OnPush` or
  `standalone: true` — both are Angular 22 defaults and must not be declared.
- Assuming `strict` TypeScript is off because the CLI scaffold shipped without
  it. It is on; write strict-clean code.
- Reaching for `ngClass`/`ngStyle` or `*ngIf`/`*ngFor` instead of `class`/`style`
  bindings and native control flow.
