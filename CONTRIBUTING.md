# Contributing

## First-time setup

After the GitHub repository is created and you have accepted an invitation:

```sh
git clone <repository-url>
cd <repository-folder>
git switch -c feature/your-task
```

Follow the Python environment and database setup in [README.md](README.md). The three workstreams and file ownership boundaries are in [docs/TEAM_TASKS.md](docs/TEAM_TASKS.md). Run `python -m pytest -q` before opening a pull request; GitHub Actions runs the same tests.

## Daily workflow

Start each task from an up-to-date `main` with a clean working tree:

```sh
git switch main
git pull --ff-only origin main
git switch -c feature/your-task
```

Keep changes focused on one task. Before committing, inspect your changes and stage only the files you intend to share:

```sh
git diff
git add <files-you-changed>
git commit -m "Add business funding request form"
git push -u origin feature/your-task
```

Open a pull request into `main`. Describe what changed, link the issue, include screenshots for UI changes, and explain how you checked your work. Request a teammate's review before merging.

## Coordinating work

- Assign each issue an owner and describe the expected result.
- Agree on API contracts and shared data types in `docs/` before integrating modules.
- Tell teammates when you need to edit files they are actively changing.
- Commit small, working increments and raise blockers early.
- If a conflict occurs, resolve it with the teammate who owns the other change. Avoid force-pushing shared branches.

## Before merging

- Run the checks available for the code you changed.
- Verify the relevant demo flow still works.
- Update setup instructions if dependencies or configuration changed.
- Keep credentials, private keys, real customer data, and local environment files out of Git.

Maintainers should configure a GitHub ruleset for `main` that requires pull requests and one approval, where available. Enable required status checks after the project has a CI workflow.
