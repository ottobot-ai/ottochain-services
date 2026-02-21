# Changelog

## [0.5.0](https://github.com/ottobot-ai/ottochain-services/compare/v0.4.1...v0.5.0) (2026-02-21)


### Features

* add rejection API assertions to integration tests ([#131](https://github.com/ottobot-ai/ottochain-services/issues/131)) ([4dff0f0](https://github.com/ottobot-ai/ottochain-services/commit/4dff0f07a69e6de9c63a7126b7bf8e163e5b4f77))
* **gateway:** add Market types to GraphQL schema ([#120](https://github.com/ottobot-ai/ottochain-services/issues/120)) ([4fff1b0](https://github.com/ottobot-ai/ottochain-services/commit/4fff1b0789066dcd115121ef2de668516794c97b))
* **traffic-gen:** add TokenEscrow fiber type ([#115](https://github.com/ottobot-ai/ottochain-services/issues/115)) ([4be8932](https://github.com/ottobot-ai/ottochain-services/commit/4be8932cd1b810bc55b995b83f5d22cd72fb34a2))


### Bug Fixes

* **traffic-gen:** exclude integration tests from vitest ([#128](https://github.com/ottobot-ai/ottochain-services/issues/128)) ([6ca0b0c](https://github.com/ottobot-ai/ottochain-services/commit/6ca0b0cda7e435f873a205473df09a7fd0e68b6b))
* use npm @ottochain/sdk instead of GitHub refs ([#130](https://github.com/ottobot-ai/ottochain-services/issues/130)) ([32b1390](https://github.com/ottobot-ai/ottochain-services/commit/32b1390bcb050bd95e6ef6663d448232b5e8fefe))

## [0.4.1](https://github.com/ottobot-ai/ottochain-services/compare/v0.4.0...v0.4.1) (2026-02-19)


### Bug Fixes

* **ci:** add robust DL1 cluster join with retry logic ([#117](https://github.com/ottobot-ai/ottochain-services/issues/117)) ([ac2c156](https://github.com/ottobot-ai/ottochain-services/commit/ac2c1560fec2f24373bbea707aea512986aa736e))

## [0.4.0](https://github.com/ottobot-ai/ottochain-services/compare/v0.3.6...v0.4.0) (2026-02-19)


### Features

* add Codecov integration for test coverage reporting ([#98](https://github.com/ottobot-ai/ottochain-services/issues/98)) ([989e411](https://github.com/ottobot-ai/ottochain-services/commit/989e41114ee98b4c68c986e8f9956ad6add54e24))
* **indexer:** rejection query API with full filter support ([#105](https://github.com/ottobot-ai/ottochain-services/issues/105)) ([e18603a](https://github.com/ottobot-ai/ottochain-services/commit/e18603a4849c09bf7b7d34c98cdfd168ab3c678e))
* **monitor:** add traffic generator status to status page ([#104](https://github.com/ottobot-ai/ottochain-services/issues/104)) ([6477da3](https://github.com/ottobot-ai/ottochain-services/commit/6477da3ebc87d529e5062863534b0a3d4959baba))


### Bug Fixes

* **bridge:** optimistic per-fiber sequence cache (Issue [#109](https://github.com/ottobot-ai/ottochain-services/issues/109)) ([#113](https://github.com/ottobot-ai/ottochain-services/issues/113)) ([fa4590c](https://github.com/ottobot-ai/ottochain-services/commit/fa4590c7cf5a70b3e0a81074dba33f16ed580585))
* **monitor:** disable basic auth by default ([#102](https://github.com/ottobot-ai/ottochain-services/issues/102)) ([3b6e98d](https://github.com/ottobot-ai/ottochain-services/commit/3b6e98db1f85841c211e3e3bcb2ba5e23a2301c2))
* **tests:** add state normalization and benign rejection filtering ([#112](https://github.com/ottobot-ai/ottochain-services/issues/112)) ([19d8fc9](https://github.com/ottobot-ai/ottochain-services/commit/19d8fc9b96ef2f5a493b2c8dc6c4399db0b03943))

## [0.3.6](https://github.com/ottobot-ai/ottochain-services/compare/v0.3.5...v0.3.6) (2026-02-17)


### Bug Fixes

* **ci:** wait for ALL DL1 nodes before peer ID verification ([#101](https://github.com/ottobot-ai/ottochain-services/issues/101)) ([89ec214](https://github.com/ottobot-ai/ottochain-services/commit/89ec2141348620e6135ef4d6fac21a40708cd118))
* **monitor:** add plural node URL env vars for health checks ([#99](https://github.com/ottobot-ai/ottochain-services/issues/99)) ([97bae67](https://github.com/ottobot-ai/ottochain-services/commit/97bae678a4512c844797f2b8d7fc8d2917461dc3))

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
