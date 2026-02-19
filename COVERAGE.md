# Test Coverage

This project uses [Codecov](https://codecov.io) for test coverage reporting.

## Setup

Coverage is automatically collected and reported on every pull request and push to main.

### Configuration

- `codecov.yml` - Codecov configuration
- GitHub Actions CI workflow includes coverage collection
- Target: 70% overall coverage, 80% for new changes

### Running Coverage Locally

```bash
# Run coverage for all packages
pnpm test:coverage

# Run coverage for specific package
cd packages/bridge
pnpm test:coverage
```

### Coverage Collection Methods

- **Bridge Package**: Uses Node.js built-in test runner with `--experimental-test-coverage`
- **Traffic Generator**: Uses Vitest with v8 coverage provider

### Coverage Reports

Coverage files are generated in each package's `coverage/` directory:
- `coverage/lcov.info` - LCOV format for Codecov
- `coverage/index.html` - HTML report for local viewing (Vitest only)

## Branch Protection

Codecov status checks are configured in:
- Project coverage: minimum 70%
- Patch coverage: minimum 80%
- 5% threshold allowance for both

Coverage failures won't block PRs but will show as status checks.