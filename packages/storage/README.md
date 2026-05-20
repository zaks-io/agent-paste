# storage

Planned storage helper package.

Responsibilities:

- R2 key construction from ids and normalized paths.
- Content-gateway token packing, signing, and verification helpers.
- Access Link Signed URL payload packing helpers shared by `api` tests.
- Served content type mapping.

Runtime signing keys remain Worker secrets; this package should not embed secret values.
