# /specs — Feature Specifications

Use this folder to write specs before building features. A spec tells Claude Code exactly what to build, so it doesn't explore and waste tokens.

## Spec template

Create a new file: `specs/[feature-name].md`

```markdown
# Feature: [Name]

## What it does (1-2 sentences)

## Who uses it
- Portal: bank | anchor | supplier (or all)
- Roles: bank_admin, anchor_admin, etc.

## Pages/routes affected
- app/(portal)/[path]/page.tsx
- app/api/[path]/route.ts

## Database tables touched
- table_name: what fields are read/written

## UI changes
- Describe the screen layout
- Reference a file in /reference/ if it exists

## API contract
GET /api/[path]
  → { field: type, ... }

POST /api/[path]
  body: { field: type, ... }
  → { field: type, ... }

## Acceptance criteria
- [ ] Criterion 1
- [ ] Criterion 2

## What NOT to change
- List files that should be untouched
```

## Example: writing a good spec prompt for Claude Code

Bad: "Build the supplier performance page"
Good: "Read specs/supplier-performance.md and implement it exactly. Do not touch any files outside the ones listed in 'Pages/routes affected'."

The spec does the thinking. Claude Code does the building.
