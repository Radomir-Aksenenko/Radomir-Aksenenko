<div align="center">

<img src="assets/page.webp" width="100%" alt="The Radomir Times, a newspaper front page. Radomir is a designer and front-end developer. 1,770 contributions in the past year, 22 in the past week, current streak 2 days, longest 13 days, 3 stars, 13 public repositories. The picture is a city in which each tower is one week of contributions. Stack: TypeScript, JavaScript, Python, C++, C#, Go, Rust, Kotlin, Dart, HTML5, Next.js, Svelte, Tailwind CSS, Node.js, Flutter, Figma, Docker, Windows Terminal. Contacts: Telegram random_ak, email amazerust@mail.ru.">

<a href="https://t.me/random_ak"><img src="assets/telegram.webp" width="47%" alt="By Telegram: random_ak"></a>
<a href="mailto:amazerust@mail.ru"><img src="assets/email.webp" width="47%" alt="By post: amazerust@mail.ru"></a>

<sub><b>Continued on GitHub:</b> [code_to_redstone](https://github.com/Radomir-Aksenenko/code_to_redstone) &nbsp;·&nbsp; [Obsidian App](https://github.com/Radomir-Aksenenko/ObsidianVPN-App) &nbsp;·&nbsp; [Obsidian VPN](https://github.com/Radomir-Aksenenko/ObsidianVPN) &nbsp;·&nbsp; [Airport Security Lib](https://github.com/Radomir-Aksenenko/Airport-Security-Lib-ASL) &nbsp;·&nbsp; [Anti-AI UI Slop](https://github.com/Radomir-Aksenenko/ultimate-anti-ai-ui-slop) &nbsp;·&nbsp; [TANK Priborka](https://github.com/Radomir-Aksenenko/tank-priborka) &nbsp;·&nbsp; [gitai](https://github.com/Radomir-Aksenenko/gitai) &nbsp;·&nbsp; [awg-fleet](https://github.com/Radomir-Aksenenko/awg-fleet) &nbsp;·&nbsp; [Fluent Transfer](https://github.com/Radomir-Aksenenko/fluent-transfer) &nbsp;·&nbsp; [Audio Normalizer](https://github.com/Radomir-Aksenenko/audio-normalizer)</sub>

</div>

<details>
<summary><sub>Read this edition as text</sub></summary>

### OBSIDIAN APP GOES OUT AS V2.0.7

KRASNOYARSK, Nov. 8. GitHub's ledger shows 22 contributions for the seven days ended today, down from 42 the week before and below the year's weekly mean of 34. Obsidian App went out as v2.0.7 on Nov. 7, with 16 commits on the branch in the past seven days.

The public log for the week holds 18 commits in 2 repositories: Obsidian App with 16 and Obsidian VPN with 2.

The most recent entry, under Obsidian App on Nov. 7, reads: "update to separate client addresses and the iOS memory fix."

Radomir is a designer and front-end developer, the profile states. The account opened in October, 2022, and holds 13 public repositories, with Dart, Go, JavaScript, C#, TypeScript, Python, Kotlin, Rust and C++ as their leading languages.

GitHub credits it with 1,770 contributions in the past twelve months, private work included. The heaviest week began on Sept. 27 and brought 166. The longest unbroken run stands at 13 days.

### [Compiler Lays the Redstone So Nobody Has To](https://github.com/Radomir-Aksenenko/code_to_redstone)

KRASNOYARSK, Nov. 8. Nobody need lay dust, repeaters and comparators by hand any longer, the code_to_redstone README says. A circuit is described in code or as a graph of nodes, and the compiler returns a finished build as a .schem, .litematic or .mcfunction file.

The repository took 42 commits in the past month; the latest of them reads, "dense router and compactness test; add README and."

Placement and routing are automatic. Every structure generated in the tests goes through a simulator that follows Java Edition rules tick by tick, and the result is checked against the logical model.

A small language called RSL describes a full adder in a few lines. A React editor does the same work in a browser, and an annealing search hunts for gates built without torches or repeaters.

Cells come in fast and compact modes, among them an XOR made from two comparators. The router is deterministic and works in channels, with branches at y=1 and trunks at y=3.

### [One Flutter App Serves Five Systems, and Installs Its Server](https://github.com/Radomir-Aksenenko/ObsidianVPN-App)

KRASNOYARSK, Nov. 8. A client for Obsidian followed in a separate repository, ObsidianVPN-App, now at 50 commits. It is one Flutter application for Windows, macOS, Linux, Android and iOS, and it can set up the Go server on an owner's own VPS over SSH, along with a small keyserver script.

The repository took 21 commits in the past month; the latest of them reads, "update to separate client addresses and the iOS memory fix." The current release is v2.0.7, out Nov. 7.

The Go core is attached as a submodule. The apps are built only in GitHub Actions, where one workflow compiles for all five systems and another publishes the release.

### [VPN Protocol Takes Aim at the Censors' Filters](https://github.com/Radomir-Aksenenko/ObsidianVPN)

KRASNOYARSK, Nov. 8. Obsidian, an open layer-3 network protocol, was built to defeat deep packet inspection, active probing and state-level censors such as the TSPU system, according to its specification.

The repository took 6 commits in the past month; the latest of them reads, "raise the iOS memory limit, repair port hopping, mask." The current release is v1.2.0, out Oct. 8.

Application-level proxies like VLESS, Shadowsocks and Trojan work on streams. Obsidian creates a full virtual network interface instead. Its README claims throughput above 350 megabits a second and no TCP-over-TCP slowdown for games, streaming and live calls.

Fixed identifiers give most protocols away, the document argues. WireGuard marks a handshake with one byte value and its transport data with another, and a filter can block both by matching a pattern. Obsidian draws random four-byte headers from ranges and varies its padding.

Traffic is sealed with ChaCha20-Poly1305. Keys are exchanged by X25519 or the post-quantum ML-KEM, and a sliding window guards against replay. The control channel replays a REALITY TLS 1.3 ClientHello, while fast data moves over UDP with port hopping, timing jitter and background noise.

Android, iOS, Linux, macOS and Windows are listed as supported. The project calls its status beta and offers the code as an open specification with a reference implementation.

### [Airport Game Gets a Mod Kit; A Folder Is All It Asks](https://github.com/Radomir-Aksenenko/Airport-Security-Lib-ASL)

KRASNOYARSK, Nov. 8. ASL, a modding framework for Airport Security Sucks!, turns a bare BepInEx 6 install into a platform where a folder dropped in mods/ simply loads. It has 2 stars so far.

Its last push came on Oct. 15. The current release is v0.1.0, out June 17.

Authors may ship no-code content, C# scripts compiled at runtime or finished DLLs, all on one API for logging, game events and hooks. The status reads early but functional, verified in the game, with the public API not yet frozen.

A full networking stack is in place as well, with identity, synced state and message transport over Mirror.

### [Design Library Takes On the Three Identical Cards](https://github.com/Radomir-Aksenenko/ultimate-anti-ai-ui-slop)

KRASNOYARSK, Nov. 8. Neon blobs, watery marketing copy and three identical cards are what the README calls first-order clichés of generated design. The library of modular skills goes after those, then after a second order: dogmatic dark tech styling, a mandatory 7:5 bento and bans on tables.

Its last push came on Sept. 10.

Work starts from the user's task, the shape of the data, the brand and the accessibility floor, which the README sets at WCAG 2.1 AA with keyboard navigation, touch ergonomics and reduced motion. A twelve-point audit closes the job before release.

The repository also holds Figma guidance on tokens and components, and a research pipeline for studying visual material.

### [Tank Dashboard Only Listens, and Writes Nothing to the Car](https://github.com/Radomir-Aksenenko/tank-priborka)

KRASNOYARSK, Nov. 8. TANK Priborka is a digital instrument cluster for the TANK 500, the TANK 300 and other GWM vehicles running NOBO Automotive IN9.0-OS on a Snapdragon SA8155P.

Its last push came on Aug. 31. The current release is v1.0.4, out Aug. 31.

It draws a 270-degree speedometer to 240 km/h, an 8,000 r.p.m. tachometer, a compass and tire pressure for each wheel. It listens to the CAN bus and FDBus and, by its own account, writes nothing to the car's control blocks. It also carries a catalog of more than 825 alarm codes.

### [An Issue Goes In, a Reviewed Pull Request Comes Out](https://github.com/Radomir-Aksenenko/gitai)

KRASNOYARSK, Nov. 8. A label on an issue starts the line. A strong model writes the specification that every later stage is judged against, and cheap models then work on it in parallel, each in a sandbox of its own.

Its last push came on Aug. 16.

Next comes the gate: build, tests, lint, scope and size. "No model gets a vote here," the README says. Attempts that fail go back with precise instructions from an editor stage.

Survivors get one reviewer apiece. An arbiter, again a strong model, picks a winner or sends the whole round back, and only then does a pull request reach a human.

The gate is the point of the design. "A hundred iterations of models grading each other converge on code that reads well and does not run," the README says, so nothing reaches a reviewer until it compiles and the tests pass.

The Rust program works against Gitea, Forgejo, GitHub and GitLab and runs whatever models its operator points it at, local ones included.

The README is plain about the limits. Every stage is implemented and the loop runs end to end, it says, but it has not yet had a real repository at scale, with real models, over weeks.

### [One Config Serves a Whole Fleet of AmneziaWG Servers](https://github.com/Radomir-Aksenenko/awg-fleet)

KRASNOYARSK, Nov. 8. WireGuard and AmneziaWG are point to point: a client config pins one endpoint and one server key, so a domain cannot simply be spread across servers that hold keys of their own.

Its last push came on July 14.

Awg-fleet settles it the way commercial providers do. Every node shares one server keypair and one peer list, so a client can complete its handshake with any of them.

Each client is pinned to a node when created and told apart by a personal port. Whichever node DNS hands it, the fleet relays it home, and websites go on seeing one address.

Placement follows measured capacity. Each node's cores and network speed are benchmarked when it joins and again every Monday at midnight, Krasnoyarsk time, so a gigabit box takes about ten times the clients of a 100-megabit one.

Two missed probes and a dead node's clients are repointed at a live one, with their configs untouched. They return when the node recovers.

Tunnel MTU is pinned low and every node clamps TCP MSS to the path, so large packets do not vanish behind a reseller who quietly delivers less than 1,500 bytes.

### [File Client in Windows 11 Dress Speaks SFTP, FTP and FTPS](https://github.com/Radomir-Aksenenko/fluent-transfer)

KRASNOYARSK, Nov. 8. Fluent Transfer speaks SFTP, FTP and FTPS from two panes, local on the left and remote on the right. It keeps passwords with Windows DPAPI, runs one to four transfers at once and takes files by drag and drop.

Its last push came on May 4.

### [Sound Leveled in Video Files by the Broadcast Standard](https://github.com/Radomir-Aksenenko/audio-normalizer)

KRASNOYARSK, Nov. 8. Audio Normalizer applies the EBU R128 broadcast standard to video soundtracks and can suppress noise with RNNoise. It works through folders in batches, and PyTorch can lend it a GPU.

Its last push came on Sept. 2, 2025. The current release is v2.0.0, out Sept. 2, 2025.

</details>
