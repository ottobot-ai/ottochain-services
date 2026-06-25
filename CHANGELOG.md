# Changelog

## [1.0.3](https://github.com/ottobot-ai/ottochain-services/compare/v1.0.2...v1.0.3) (2026-06-25)


### Miscellaneous

* adopt @ottochain/sdk v2.4.0 — Metakit 1.8 drop-null content-hash convention ([#296](https://github.com/ottobot-ai/ottochain-services/issues/296))
* batch dependabot dependency + GitHub Actions updates ([#298](https://github.com/ottobot-ai/ottochain-services/issues/298))

## [1.0.2](https://github.com/ottobot-ai/ottochain-services/compare/v1.0.1...v1.0.2) (2026-03-27)


### Bug Fixes

* **traffic-gen:** align fiber weights with actual FIBER_DEFINITIONS ([#272](https://github.com/ottobot-ai/ottochain-services/issues/272)) ([30f0ca8](https://github.com/ottobot-ai/ottochain-services/commit/30f0ca85c146780038900d8111879ed5a9650493))
* **traffic-gen:** avoid double-call to getRegisteredAgents in provider ([#270](https://github.com/ottobot-ai/ottochain-services/issues/270)) ([c73bee6](https://github.com/ottobot-ai/ottochain-services/commit/c73bee6e21ec1a11b300643026e90d87ab83cbcf)), closes [#179](https://github.com/ottobot-ai/ottochain-services/issues/179)

## [1.0.1](https://github.com/ottobot-ai/ottochain-services/compare/v1.0.0...v1.0.1) (2026-03-22)


### Bug Fixes

* **traffic-gen:** replace oracles shim with identity.getIdentityDefinition ([d8799ed](https://github.com/ottobot-ai/ottochain-services/commit/d8799ed732265dcb4e4693c1ccbebc46de824f5a))

## [1.0.0](https://github.com/ottobot-ai/ottochain-services/compare/v0.13.0...v1.0.0) (2026-03-22)


### ⚠ BREAKING CHANGES

* align with SDK fiber apps overhaul ([#260](https://github.com/ottobot-ai/ottochain-services/issues/260))

### Bug Fixes

* add DATABASE_URL to traffic-gen container ([#259](https://github.com/ottobot-ai/ottochain-services/issues/259)) ([484d115](https://github.com/ottobot-ai/ottochain-services/commit/484d115436d676373232cc07455682475b77f36b))


### Code Refactoring

* align with SDK fiber apps overhaul ([#260](https://github.com/ottobot-ai/ottochain-services/issues/260)) ([ead3182](https://github.com/ottobot-ai/ottochain-services/commit/ead3182eb3915b9a8b7512cddc15321cbb52088d))

## [0.13.0](https://github.com/ottobot-ai/ottochain-services/compare/v0.12.0...v0.13.0) (2026-03-20)


### Features

* **ci:** add compatibility-check workflow for cross-repo integration testing ([#253](https://github.com/ottobot-ai/ottochain-services/issues/253)) ([d01542b](https://github.com/ottobot-ai/ottochain-services/commit/d01542bebbb2f7233c4f20d5612c94ff546fef1b))
* **ci:** auto-merge SDK bump PRs ([#256](https://github.com/ottobot-ai/ottochain-services/issues/256)) ([ffc7549](https://github.com/ottobot-ai/ottochain-services/commit/ffc75492ea7cfe0e3fb11a49f2fe727a69670792))

## [0.12.0](https://github.com/ottobot-ai/ottochain-services/compare/v0.11.0...v0.12.0) (2026-03-18)


### Features

* **gateway:** Apollo Server v5 migration ([#249](https://github.com/ottobot-ai/ottochain-services/issues/249)) ([d0fd706](https://github.com/ottobot-ai/ottochain-services/commit/d0fd706025fd601dc39d628fffcb8b7da62f990f))
* signing modes for agent registration (server/self) [rebased] ([#248](https://github.com/ottobot-ai/ottochain-services/issues/248)) ([caedac5](https://github.com/ottobot-ai/ottochain-services/commit/caedac5923a72001fa3e7fc6e97c949f0e62553e))


### Bug Fixes

* **ci:** add --force to sdk-bump workflow ([#250](https://github.com/ottobot-ai/ottochain-services/issues/250)) ([ca63b44](https://github.com/ottobot-ai/ottochain-services/commit/ca63b443acbd6ca8bb84150a05f2cebba2e0962d))
* **gateway:** add express.json() middleware for Apollo Server v5 ([#251](https://github.com/ottobot-ai/ottochain-services/issues/251)) ([6bfa803](https://github.com/ottobot-ai/ottochain-services/commit/6bfa8036da8af02acb2dcd862e583d2665dbabaf))
* migrate to Prisma v7 (prisma.config.ts + client datasourceUrl) ([#246](https://github.com/ottobot-ai/ottochain-services/issues/246)) ([e116f5a](https://github.com/ottobot-ai/ottochain-services/commit/e116f5a78899ae17f290afe17932573e2fe67b7a))

## [0.11.0](https://github.com/ottobot-ai/ottochain-services/compare/v0.10.0...v0.11.0) (2026-03-13)


### Features

* **traffic-gen:** v2 weighted distribution engine (Cards 1-4) ([#218](https://github.com/ottobot-ai/ottochain-services/issues/218)) ([714755e](https://github.com/ottobot-ai/ottochain-services/commit/714755ed83ac7f952781b36bb2d7ff899b9c10a9))

## [0.10.0](https://github.com/ottobot-ai/ottochain-services/compare/v0.9.0...v0.10.0) (2026-03-13)


### Features

* add SDK version bump workflow ([#214](https://github.com/ottobot-ai/ottochain-services/issues/214)) ([7e4d6cd](https://github.com/ottobot-ai/ottochain-services/commit/7e4d6cd41856c488ac45d029527e807bea7e5837))
* **bridge+indexer:** push-based transaction confirmation via indexer callback ([#224](https://github.com/ottobot-ai/ottochain-services/issues/224)) ([f74a30b](https://github.com/ottobot-ai/ottochain-services/commit/f74a30bdc924d0f7f21a1486f0a968bbc2e5a625))
* **indexer:** migrate to @ottochain/sdk for metagraph HTTP calls ([#215](https://github.com/ottobot-ai/ottochain-services/issues/215)) ([3bbf365](https://github.com/ottobot-ai/ottochain-services/commit/3bbf365f4199c57262b49b5c719119c2bb9d7803))


### Bug Fixes

* auto-migrate database schema on container startup ([#217](https://github.com/ottobot-ai/ottochain-services/issues/217)) ([99fcafb](https://github.com/ottobot-ai/ottochain-services/commit/99fcafb6d4e38ac73b48ebbc5869d4b702e4574f))
* **ci:** restart stuck DL1 nodes during cluster join ([#235](https://github.com/ottobot-ai/ottochain-services/issues/235)) ([2bb06cd](https://github.com/ottobot-ai/ottochain-services/commit/2bb06cdd3a1378e9243e43ba77a59e15ab92fd37))
* **ci:** use OTTOBOT_PAT for SDK bump PRs ([#236](https://github.com/ottobot-ai/ottochain-services/issues/236)) ([bb79a84](https://github.com/ottobot-ai/ottochain-services/commit/bb79a842473b84c8d592f4ee2763c8832430d99b))
* **ci:** wait for DL1 cluster session propagation after join ([#233](https://github.com/ottobot-ai/ottochain-services/issues/233)) ([29ab302](https://github.com/ottobot-ai/ottochain-services/commit/29ab3027fcf61bbad0caddb805299e9a3b447667))
* indexer confirmation pipeline and database migrations ([#225](https://github.com/ottobot-ai/ottochain-services/issues/225)) ([a352d42](https://github.com/ottobot-ai/ottochain-services/commit/a352d4213f98a9acb4bcce06f202cfeb0a5d5985))
* **indexer:** require METAGRAPH_ID and batch-confirm snapshots ([#222](https://github.com/ottobot-ai/ottochain-services/issues/222)) ([7240963](https://github.com/ottobot-ai/ottochain-services/commit/72409636e0e21da2885621bc0b193dc26a8c7173))
* read INDEXER_URL env var in standard simulator mode ([#216](https://github.com/ottobot-ai/ottochain-services/issues/216)) ([2bff167](https://github.com/ottobot-ai/ottochain-services/commit/2bff167e5e8c51f241e9277f92992d180445e063))

## [0.9.0](https://github.com/ottobot-ai/ottochain-services/compare/v0.8.1...v0.9.0) (2026-03-05)


### Features

* **indexer:** add timestamp_from/to filters + Prisma migration for rejection queries ([#211](https://github.com/ottobot-ai/ottochain-services/issues/211)) ([53f2e0b](https://github.com/ottobot-ai/ottochain-services/commit/53f2e0b6ed93c3b5d2bc95156f9f4853289c852f))

## [0.8.1](https://github.com/ottobot-ai/ottochain-services/compare/v0.8.0...v0.8.1) (2026-03-04)


### Bug Fixes

* **monitor:** treat disabled traffic gen as healthy, not degraded ([#205](https://github.com/ottobot-ai/ottochain-services/issues/205)) ([161dc5c](https://github.com/ottobot-ai/ottochain-services/commit/161dc5ca644714ba13b3ab5551d3d27737f2edfb))
* move express type import to top of file in metrics.ts (issue [#169](https://github.com/ottobot-ai/ottochain-services/issues/169)) ([#209](https://github.com/ottobot-ai/ottochain-services/issues/209)) ([8da1af4](https://github.com/ottobot-ai/ottochain-services/commit/8da1af444c7eb0ed9fd52cbd74c624ebc0b505b7))

## [0.8.0](https://github.com/ottobot-ai/ottochain-services/compare/v0.7.1...v0.8.0) (2026-03-03)


### Features

* **monitor:** extend stack coverage to explorer and observability services ([#199](https://github.com/ottobot-ai/ottochain-services/issues/199)) ([fb25b80](https://github.com/ottobot-ai/ottochain-services/commit/fb25b80f9eacd7ff1babac35fbd53be4ac74e107))


### Bug Fixes

* add curl to production Docker image ([#201](https://github.com/ottobot-ai/ottochain-services/issues/201)) ([64e43c2](https://github.com/ottobot-ai/ottochain-services/commit/64e43c21e3fca8936c1f772a911b48876e596bb6))
* align deploy token secret name with other repos ([#202](https://github.com/ottobot-ai/ottochain-services/issues/202)) ([fe0b2dd](https://github.com/ottobot-ai/ottochain-services/commit/fe0b2dde566be450978ce296a45dd64924970e88))
* **ci:** trigger CI on develop-targeting PRs ([#184](https://github.com/ottobot-ai/ottochain-services/issues/184)) ([c701606](https://github.com/ottobot-ai/ottochain-services/commit/c70160625690a9db970e0a611bc0cbc498f94485))
* **e2e:** retry fiber submission if not confirmed within N ordinals ([#187](https://github.com/ottobot-ai/ottochain-services/issues/187)) ([917b917](https://github.com/ottobot-ai/ottochain-services/commit/917b917c5a763c7d18bdcd28375d1906272709e2))
* remove hardcoded production IPs from source code ([#188](https://github.com/ottobot-ai/ottochain-services/issues/188)) ([4526252](https://github.com/ottobot-ai/ottochain-services/commit/452625251853d902661602540489e089572d32e2))
* sequential DL1 cluster join with clusterSession validation ([#203](https://github.com/ottobot-ai/ottochain-services/issues/203)) ([2fb5cbf](https://github.com/ottobot-ai/ottochain-services/commit/2fb5cbf4fae1cc5b706329b58352979ed76e8be8))

## [0.7.1](https://github.com/ottobot-ai/ottochain-services/compare/v0.7.0...v0.7.1) (2026-02-28)


### Bug Fixes

* **traffic-gen:** add proper types for fiber/agent providers ([#177](https://github.com/ottobot-ai/ottochain-services/issues/177)) ([#181](https://github.com/ottobot-ai/ottochain-services/issues/181)) ([745b6c0](https://github.com/ottobot-ai/ottochain-services/commit/745b6c0881d78667197e078e693e4489b3df9f72))

## [0.7.0](https://github.com/ottobot-ai/ottochain-services/compare/v0.6.0...v0.7.0) (2026-02-28)


### Features

* **traffic-gen:** enhanced control UI with weights, fibers, and agents ([#175](https://github.com/ottobot-ai/ottochain-services/issues/175)) ([3b46775](https://github.com/ottobot-ai/ottochain-services/commit/3b4677520ec30cc671cc79370bcebf92ae154887))


### Bug Fixes

* **monitor:** copy HTML files to dist on build ([#173](https://github.com/ottobot-ai/ottochain-services/issues/173)) ([b2e4392](https://github.com/ottobot-ai/ottochain-services/commit/b2e439228e8af71f7de6f29b685dcf7e0cac8291))

## [0.6.0](https://github.com/ottobot-ai/ottochain-services/compare/v0.5.0...v0.6.0) (2026-02-28)


### Features

* add Prometheus /metrics endpoint to monitor ([#168](https://github.com/ottobot-ai/ottochain-services/issues/168)) ([e1e038c](https://github.com/ottobot-ai/ottochain-services/commit/e1e038c3e951b1deaf58e0dd15c8fe6350c0a3d3))
* **monitor:** add traffic control & rejections dashboards ([#171](https://github.com/ottobot-ai/ottochain-services/issues/171)) ([251251d](https://github.com/ottobot-ai/ottochain-services/commit/251251d39ced91cda3bbc516245435341a4ed74f))

## [0.5.0](https://github.com/ottobot-ai/ottochain-services/compare/v0.4.1...v0.5.0) (2026-02-27)


### Features

* add rejection API assertions to integration tests ([#131](https://github.com/ottobot-ai/ottochain-services/issues/131)) ([4dff0f0](https://github.com/ottobot-ai/ottochain-services/commit/4dff0f07a69e6de9c63a7126b7bf8e163e5b4f77))
* Bridge fan-out to all DL1 nodes (fork prevention) ([#136](https://github.com/ottobot-ai/ottochain-services/issues/136)) ([624432f](https://github.com/ottobot-ai/ottochain-services/commit/624432f77a1e6a7aa67af2007dc2db53526da75e))
* **bridge:** add response time percentiles to /health endpoint ([#134](https://github.com/ottobot-ai/ottochain-services/issues/134)) ([1c541b5](https://github.com/ottobot-ai/ottochain-services/commit/1c541b527aab66ef89148060475599beb7f09cf4))
* **bridge:** Token domain routes — spec + implementation ([#144](https://github.com/ottobot-ai/ottochain-services/issues/144)) ([ef5e5a3](https://github.com/ottobot-ai/ottochain-services/commit/ef5e5a36a94f1a43e54753dd7e64ac449d145467))
* **ci:** use pre-built JARs from versions.yaml ([#137](https://github.com/ottobot-ai/ottochain-services/issues/137)) ([ad4b9e4](https://github.com/ottobot-ai/ottochain-services/commit/ad4b9e4e29780914a5aa54ee960c4cd6401a87db))
* **gateway:** add Market types to GraphQL schema ([#120](https://github.com/ottobot-ai/ottochain-services/issues/120)) ([4fff1b0](https://github.com/ottobot-ai/ottochain-services/commit/4fff1b0789066dcd115121ef2de668516794c97b))
* **monitor:** add monitoring events API for status page ([#143](https://github.com/ottobot-ai/ottochain-services/issues/143)) ([b77523e](https://github.com/ottobot-ai/ottochain-services/commit/b77523e8340b47ce2084361b6822352378a4b6ad))
* **monitor:** write watchdog health snapshot to Redis ([#167](https://github.com/ottobot-ai/ottochain-services/issues/167)) ([d5ffd1e](https://github.com/ottobot-ai/ottochain-services/commit/d5ffd1e6aae51a2440450876894b6746bf05154d))
* **traffic-gen:** add TokenEscrow fiber type ([#115](https://github.com/ottobot-ai/ottochain-services/issues/115)) ([4be8932](https://github.com/ottobot-ai/ottochain-services/commit/4be8932cd1b810bc55b995b83f5d22cd72fb34a2))


### Bug Fixes

* bump @ottochain/sdk to 1.0.2 ([#139](https://github.com/ottobot-ai/ottochain-services/issues/139)) ([aecc20a](https://github.com/ottobot-ai/ottochain-services/commit/aecc20a7f171f815345ef6b03fdc861ff759d67e))
* bump @ottochain/sdk to 1.0.3 ([#140](https://github.com/ottobot-ai/ottochain-services/issues/140)) ([b3e99f3](https://github.com/ottobot-ai/ottochain-services/commit/b3e99f380ff200fcea8c513a54caa8861b2ecb59))
* identity domain event name alignment in traffic-gen and simulator ([#142](https://github.com/ottobot-ai/ottochain-services/issues/142)) ([1b5fa7d](https://github.com/ottobot-ai/ottochain-services/commit/1b5fa7dd3ac999296749999f68819e6c8683cdcd))
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
