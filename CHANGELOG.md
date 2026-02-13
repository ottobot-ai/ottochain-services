# Changelog

## [0.3.5](https://github.com/ottobot-ai/ottochain-services/compare/v0.3.4...v0.3.5) (2026-02-13)


### Bug Fixes

* **bridge:** use epochProgress for market deadlines ([#87](https://github.com/ottobot-ai/ottochain-services/issues/87)) ([bda6107](https://github.com/ottobot-ai/ottochain-services/commit/bda6107310080340de92fa0f2b4b34e302e17bb6))
* **ci:** use proper gh api syntax for client_payload ([#93](https://github.com/ottobot-ai/ottochain-services/issues/93)) ([2aabc41](https://github.com/ottobot-ai/ottochain-services/commit/2aabc41c9a24bd5aaa06ad37eead2eba011e5738))

## [0.3.4](https://github.com/ottobot-ai/ottochain-services/compare/v0.3.3...v0.3.4) (2026-02-13)


### Bug Fixes

* **ci:** free disk space before integration tests ([#92](https://github.com/ottobot-ai/ottochain-services/issues/92)) ([0781923](https://github.com/ottobot-ai/ottochain-services/commit/0781923e18919b202d59e9f899cf9af074cf1761))
* **ci:** use correct database in postgres health check ([#89](https://github.com/ottobot-ai/ottochain-services/issues/89)) ([5e9ff9a](https://github.com/ottobot-ai/ottochain-services/commit/5e9ff9ae36c6c8cd3f01c133b4cb908516b60db3))
* **ci:** use external network instead of socat proxy ([#88](https://github.com/ottobot-ai/ottochain-services/issues/88)) ([bc1f2db](https://github.com/ottobot-ai/ottochain-services/commit/bc1f2db08c15c87aeb366dfff870b084d2ba2267))

## [0.3.3](https://github.com/ottobot-ai/ottochain-services/compare/v0.3.2...v0.3.3) (2026-02-12)


### Bug Fixes

* copy prisma schema to production Docker image ([#82](https://github.com/ottobot-ai/ottochain-services/issues/82)) ([12d9a15](https://github.com/ottobot-ai/ottochain-services/commit/12d9a15ae6b9297511300863513f646b69ccff19))
* normalize state labels to UPPER CASE ([#84](https://github.com/ottobot-ai/ottochain-services/issues/84)) ([1dde6f3](https://github.com/ottobot-ai/ottochain-services/commit/1dde6f39b470e6a170e1bdf34e756581caf85582))

## [0.3.2](https://github.com/ottobot-ai/ottochain-services/compare/v0.3.1...v0.3.2) (2026-02-11)


### Bug Fixes

* use GH_TOKEN env var for gh api command ([#78](https://github.com/ottobot-ai/ottochain-services/issues/78)) ([21edff6](https://github.com/ottobot-ai/ottochain-services/commit/21edff61275a8a631bc49a2522807307ddb9d88d))

## [0.3.1](https://github.com/ottobot-ai/ottochain-services/compare/v0.3.0...v0.3.1) (2026-02-11)


### Bug Fixes

* add Prisma binaryTarget for Debian Bookworm (OpenSSL 3.0) ([#74](https://github.com/ottobot-ai/ottochain-services/issues/74)) ([a54d5e9](https://github.com/ottobot-ai/ottochain-services/commit/a54d5e955e4e196e6144e37d71a379800f20cfce))

## [0.3.0](https://github.com/ottobot-ai/ottochain-services/compare/v0.2.0...v0.3.0) (2026-02-10)


### Features

* add Docker Compose for full containerized deployment ([#63](https://github.com/ottobot-ai/ottochain-services/issues/63)) ([2d4b3ee](https://github.com/ottobot-ai/ottochain-services/commit/2d4b3ee858194d1a0ad559b1ef1ce0022ad604bf))
* add explorer service to docker-compose stack ([#64](https://github.com/ottobot-ai/ottochain-services/issues/64)) ([bd19f47](https://github.com/ottobot-ai/ottochain-services/commit/bd19f47b8f000fb5b21d5664aa1405b192f72a43))
* **bridge:** mount corporate governance routes + OpenAPI docs ([#65](https://github.com/ottobot-ai/ottochain-services/issues/65)) ([2b8d2a4](https://github.com/ottobot-ai/ottochain-services/commit/2b8d2a474b46cb08085f40baf3bfd7f7b5da2edd))
* **ci:** add release-please for automated releases ([#72](https://github.com/ottobot-ai/ottochain-services/issues/72)) ([1b1e198](https://github.com/ottobot-ai/ottochain-services/commit/1b1e1985cf386707b02c1e2e1a34dfdac35bdfe5))
* notify deploy repo on release ([#67](https://github.com/ottobot-ai/ottochain-services/issues/67)) ([2216104](https://github.com/ottobot-ai/ottochain-services/commit/2216104b34b064cb36f15484e12151988d979d1a))


### Bug Fixes

* **ci:** add key distribution verification and debugging for DL1 cluster ([#70](https://github.com/ottobot-ai/ottochain-services/issues/70)) ([9714155](https://github.com/ottobot-ai/ottochain-services/commit/9714155918c0e79618c3ab043a8a8da02da3bdf4))
* **ci:** move secrets check inside run script ([#71](https://github.com/ottobot-ai/ottochain-services/issues/71)) ([9a39e39](https://github.com/ottobot-ai/ottochain-services/commit/9a39e392c404424b71cae3f01cade828dfb17783))
* switch to Debian-slim for Prisma OpenSSL compatibility ([#66](https://github.com/ottobot-ai/ottochain-services/issues/66)) ([eb98c7b](https://github.com/ottobot-ai/ottochain-services/commit/eb98c7b89c29d7e3cd24cf5ea2bf1861e80b25b7))
* use DL1 sequence numbers consistently across all routes ([#69](https://github.com/ottobot-ai/ottochain-services/issues/69)) ([7ec01be](https://github.com/ottobot-ai/ottochain-services/commit/7ec01beb625ae4beba3272bfbbd413a135397acc))
