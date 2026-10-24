# SME Lending Pools

**Helping small and medium-sized enterprises access cash today against future incoming payments.**

## About our group

We are a group of friends building together for a hackathon. Our team is working across product, design, and engineering to explore how lending pools could help small businesses bridge the gap between making a sale and receiving payment.

This repository is our shared workspace. We will build different parts of the product, review one another's changes, and bring them together into a working demo.

### Our team

- Arya Prabhu
- [Gabriel Leguen](https://github.com/gableguen)
- [Benjamin Leguen](https://github.com/Benjileguen)
- Matias Neira

## The product

Small businesses often have incoming payments on the horizon while needing cash now for inventory, payroll, or day-to-day operations. Our idea is **lending pools that help SMEs unlock liquidity against future incoming transactions**.

In our proposed experience, a business submits an eligible future payment for review. A pool of capital can then fund an advance against that payment. When the payment arrives, it is reconciled with the outstanding advance under the agreed terms.

This is a hackathon prototype. The workflows below describe what we intend to explore; they are not claims of implemented features or a live lending service.

## Proposed demo flow

1. **Business submits a request:** enter the expected payment amount, due date, and supporting details.
2. **Request is reviewed:** assess eligibility and show proposed advance and repayment terms.
3. **Pool funds the advance:** simulate allocating available pool capital to an approved request.
4. **Business tracks progress:** view the request, advance, and expected repayment status.
5. **Payment is reconciled:** simulate receipt of the future payment and update the pool balance.

## MVP scope

- A business dashboard for submitting and tracking funding requests.
- A pool dashboard showing available capital and funded requests.
- A review flow with explicit approval and rejection states.
- A simulated funding and repayment lifecycle.
- Seeded demo data so the team can show the full experience.

For the demo, use synthetic business and transaction data. Real payment integrations, custody, underwriting, pricing, and production lending requirements remain future design decisions.

## Project structure

```text
apps/web/       User interface and dashboards
services/api/   Backend endpoints and business logic
packages/shared/ Shared types, schemas, and utilities
docs/           Product notes, API agreements, and demo instructions
```

The folders are starting points. We have not selected a framework or added runnable application code yet. Add installation, environment variable, and development commands here when the stack is chosen.

## Building together

Read [CONTRIBUTING.md](CONTRIBUTING.md) before your first change.

1. Claim a task in GitHub Issues and agree on which files or module you own.
2. Create a short-lived branch such as `feature/business-dashboard` or `fix/pool-balance`.
3. Build your part and open a pull request into `main`.
4. Ask a teammate to review and run the relevant checks before merging.
5. Pull the latest `main` before starting the next task.

Use issues for tasks and blockers, pull requests for code discussions, and `docs/` for decisions the whole team needs. Agree on shared API shapes before connecting the frontend and backend.

## Initial task ideas

- [ ] Agree on a team name, technology stack, and demo story.
- [ ] Define funding request, pool, advance, and repayment data models.
- [ ] Build the business request form and dashboard.
- [ ] Build the pool dashboard and request review flow.
- [ ] Implement simulated funding and repayment logic.
- [ ] Add demo data and document how to run the project.
- [ ] Test the end-to-end demo and rehearse the presentation.
