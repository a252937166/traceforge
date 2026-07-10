# Security policy

TraceForge currently operates only on the synthetic workflow included in this repository. Do not connect it to a production tenant or database.

## Reporting

Please report a vulnerability privately through GitHub Security Advisories once the public repository is available. Do not include credentials, raw customer data, database dumps, or captured session tokens in an issue.

## Trust boundaries

- Captured application content is untrusted input.
- Model-generated contracts and code are untrusted candidates.
- The deterministic verifier and immutable legacy baseline are the acceptance authority.
- Deployment, pull-request publication, and access to a non-synthetic system require human approval.

