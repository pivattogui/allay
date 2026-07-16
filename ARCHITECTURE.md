# Allay Architecture Map

This document is the visual source of truth for Allay's current architecture. It maps the deployed system, backend modules, OTP processes, HTTP and WebSocket interfaces, background workers, persistence model, and frontend composition.

## System map

This is the primary at-a-glance view. Solid arrows represent calls or data flow; dotted arrows represent events or scheduled execution.

```mermaid
flowchart LR
  user["Administrator browser"]
  players["Minecraft clients"]

  subgraph container["Allay container - single node"]
    direction LR

    subgraph frontend["React SPA"]
      pages["Pages and feature components"]
      hooks["TanStack Query hooks"]
      stores["Zustand stores"]
      api["REST client"]
      socketClient["Phoenix Socket client"]
      pages --> hooks
      pages --> stores
      hooks --> api
      stores --> socketClient
    end

    subgraph web["Phoenix web boundary"]
      endpoint["AllayWeb.Endpoint"]
      router["Router and ApiAuth"]
      controllers["Controllers and JSON serializers"]
      userSocket["UserSocket"]
      serverChannel["ServerChannel"]
      static["SPAController and static assets"]
      endpoint --> router
      router --> controllers
      endpoint --> userSocket --> serverChannel
      router --> static
    end

    subgraph domain["Application contexts"]
      accounts["Allay.Accounts"]
      servers["Allay.Servers"]
      backups["Allay.Backups"]
      files["Allay.Files"]
      imports["Allay.Imports"]
      minecraft["Allay.Minecraft.*"]
    end

    subgraph runtime["Runtime and orchestration"]
      runtimeApi["Allay.Runtime"]
      runtimeTree["Per-server OTP subtree"]
      pubsub["Phoenix.PubSub"]
      oban["Oban queues and cron"]
      javaRegistry["JavaRegistry"]
      runtimeApi --> runtimeTree
      runtimeTree -. "status, logs, metrics" .-> pubsub
    end

    beam["BEAM / Phoenix release"]
    java["Java Minecraft processes"]
    filesystem[("DATA_DIR\nservers, backups, imports, jars")]

    controllers --> accounts
    controllers --> servers
    controllers --> backups
    controllers --> files
    controllers --> imports
    serverChannel --> servers
    serverChannel --> runtimeApi
    serverChannel -. "subscribes" .-> pubsub

    servers --> runtimeApi
    servers --> minecraft
    servers --> javaRegistry
    backups --> runtimeApi
    backups --> servers
    files --> servers
    imports --> servers
    imports --> backups
    oban -. "workers" .-> servers
    oban -. "workers" .-> backups

    runtimeTree --> java
    minecraft --> filesystem
    servers --> filesystem
    backups --> filesystem
    files --> filesystem
    imports --> filesystem
    beam --- web
  end

  postgres[("PostgreSQL\nEcto and Oban tables")]
  mojang["Mojang and Paper APIs"]

  user --> frontend
  api -->|"/api/* and /health"| endpoint
  socketClient -->|"/socket websocket"| userSocket
  players -->|"Minecraft TCP ports"| java
  accounts --> postgres
  servers --> postgres
  backups --> postgres
  oban --> postgres
  minecraft --> mojang
```

## Deployment topology

```mermaid
flowchart TB
  browser["Browser"] -->|"HTTP and WebSocket :8080"| allay
  minecraftClients["Minecraft clients"] -->|"TCP 25565..25575"| allay

  subgraph host["Docker host"]
    subgraph allay["allay container"]
      release["Phoenix release :4000"]
      jre21["Temurin JRE 21"]
      jre25["Temurin JRE 25"]
      serverProcesses["Minecraft JVM processes"]
      release --> serverProcesses
      jre21 --> serverProcesses
      jre25 --> serverProcesses
    end

    postgres["PostgreSQL 17 container"]
    appData[("./data/allay -> /app/data")]
    dbData[("./data/postgres")]

    release --> postgres
    release --> appData
    serverProcesses --> appData
    postgres --> dbData
  end
```

The current runtime registry, JVM ownership, logs, metrics, and filesystem are node-local. The supported topology is one Allay application node controlling the local Minecraft processes.

## OTP supervision tree

```mermaid
flowchart TB
  app["Allay.Application\nSupervisor one_for_one"]

  app --> telemetry["AllayWeb.Telemetry\nSupervisor"]
  app --> repo["Allay.Repo"]
  app --> oban["Oban"]
  app --> dns["DNSCluster"]
  app --> pubsub["Phoenix.PubSub"]
  app --> javaRegistry["Allay.Servers.JavaRegistry\nAgent"]
  app --> runtimeSupervisor["Allay.Runtime.Supervisor\nSupervisor one_for_one"]
  app --> boot["Allay.Servers.Boot\ntemporary Task"]
  app --> endpoint["AllayWeb.Endpoint"]

  runtimeSupervisor --> registry["Allay.Runtime.Registry\nunique Registry"]
  runtimeSupervisor --> dynamic["Allay.Runtime.ServerSupervisor\nDynamicSupervisor one_for_one"]

  dynamic --> instanceA["InstanceSupervisor server A\none_for_all, temporary"]
  dynamic --> instanceN["InstanceSupervisor server N\none_for_all, temporary"]

  instanceA --> runtimeA["ServerRuntime\nGenServer and Port owner"]
  instanceA --> watcherA["LogWatcher\nGenServer"]
  instanceA -. "started after running" .-> metricsA["MetricsSampler\nGenServer, temporary"]

  runtimeA --> portA["Erlang Port"] --> jvmA["Java process"]
  watcherA --> latestLogA["logs/latest.log"]
  runtimeA -. "Event.broadcast" .-> pubsub
  watcherA -. "Event.broadcast" .-> pubsub
  metricsA -. "Event.broadcast" .-> pubsub
```

### Per-server runtime state machine

```mermaid
stateDiagram-v2
  [*] --> stopped
  stopped --> starting: start_server
  starting --> running: RCON handshake succeeds
  starting --> crashed: startup timeout or process exit
  running --> stopping: stop command
  running --> crashed: unexpected process exit
  stopping --> stopped: process exits
  stopping --> stopped: SIGTERM then SIGKILL escalation
  crashed --> starting: auto-restart budget available
  crashed --> stopped: explicit stop or instance removal
  stopped --> [*]: remove instance
```

## Backend module map

The diagram uses UML-style dependency arrows. It intentionally groups implementation modules by responsibility while preserving every production module with domain behavior.

```mermaid
classDiagram
  namespace Infrastructure {
    class AllayApplication
    class AllayWebFacade
    class Endpoint
    class EndpointConfig
    class Telemetry
    class Release
    class Gettext
  }

  namespace Web {
    class Router
    class ApiAuth
    class AuthController
    class ServerController
    class ServerLifecycleController
    class ServerConfigController
    class ServerPropertiesController
    class ServerFileController
    class ServerIconController
    class BackupController
    class ImportController
    class SystemController
    class HealthController
    class SPAController
    class UserSocket
    class ServerChannel
    class ServerJSON
    class BackupJSON
    class ErrorJSON
    class FallbackController
    class ServerParams
  }

  namespace Contexts {
    class Accounts
    class Servers
    class Backups
    class Files
    class Imports
    class Runtime
  }

  namespace AccountModels {
    class Scope
  }

  namespace ServerServices {
    class Provisioner
    class JavaGate
    class JavaRegistry
    class RuntimeBridge
    class Boot
    class RestartTick
    class RestartWorker
  }

  namespace RuntimeProcesses {
    class RuntimeSupervisor
    class InstanceSupervisor
    class ServerRuntime
    class LogWatcher
    class MetricsSampler
    class Event
    class LogLine
    class RuntimeSpec
  }

  namespace BackupServices {
    class BackupWorker
    class SchedulerTick
  }

  namespace ImportServices {
    class Analyzer
    class Extractor
    class ImportSession
  }

  namespace FileServices {
    class PathSandbox
  }

  namespace MinecraftServices {
    class Versions
    class JarCache
    class JavaRuntime
    class Properties
    class Rcon
  }

  namespace Persistence {
    class Repo
    class User
    class UserToken
    class Server
    class Backup
    class BackupConfig
    class ObanJob
  }

  AllayApplication --> Telemetry
  AllayApplication --> Repo
  AllayApplication --> JavaRegistry
  AllayApplication --> RuntimeSupervisor
  AllayApplication --> Endpoint
  Endpoint --> EndpointConfig
  Endpoint --> Router
  Endpoint --> UserSocket
  AllayWebFacade --> Router
  AllayWebFacade --> UserSocket
  AllayWebFacade --> Gettext
  Release --> Repo

  Router --> ApiAuth
  Router --> AuthController
  Router --> ServerController
  Router --> ServerLifecycleController
  Router --> ServerConfigController
  Router --> ServerPropertiesController
  Router --> ServerFileController
  Router --> ServerIconController
  Router --> BackupController
  Router --> ImportController
  Router --> SystemController
  Router --> HealthController
  Router --> SPAController
  ApiAuth --> Accounts
  ApiAuth --> Scope

  UserSocket --> Accounts
  UserSocket --> ServerChannel
  ServerChannel --> Servers
  ServerChannel --> Runtime
  ServerChannel --> Event
  ServerChannel --> ServerJSON
  FallbackController --> ErrorJSON

  AuthController --> Accounts
  ServerController --> Servers
  ServerController --> Runtime
  ServerController --> ServerParams
  ServerLifecycleController --> Servers
  ServerConfigController --> Servers
  ServerConfigController --> ServerParams
  ServerPropertiesController --> Servers
  ServerFileController --> Files
  ServerIconController --> Servers
  BackupController --> Backups
  BackupController --> Servers
  ImportController --> Imports
  ImportController --> Analyzer
  ImportController --> ImportSession
  ImportController --> Runtime
  SystemController --> Versions
  SystemController --> JavaRegistry

  Accounts --> Repo
  Accounts --> User
  Accounts --> UserToken
  Servers --> Repo
  Servers --> Server
  Servers --> Provisioner
  Servers --> RuntimeBridge
  Servers --> Runtime
  Servers --> Backups
  Servers --> Versions
  Servers --> JarCache
  Servers --> Properties
  Backups --> Repo
  Backups --> Backup
  Backups --> BackupConfig
  Backups --> Runtime
  Backups --> Servers
  Files --> Servers
  Files --> PathSandbox
  Imports --> Servers
  Imports --> Backups
  Imports --> Analyzer
  Imports --> Extractor
  Imports --> ImportSession

  Provisioner --> JavaGate
  Provisioner --> Versions
  Provisioner --> JarCache
  Provisioner --> Properties
  Provisioner --> Repo
  JavaGate --> Versions
  JavaGate --> JavaRegistry
  JavaRegistry --> JavaRuntime
  RuntimeBridge --> JavaRegistry
  RuntimeBridge --> RuntimeSpec
  Boot --> JavaRegistry
  Boot --> Servers

  Runtime --> RuntimeSupervisor
  Runtime --> InstanceSupervisor
  InstanceSupervisor --> ServerRuntime
  InstanceSupervisor --> LogWatcher
  InstanceSupervisor --> MetricsSampler
  ServerRuntime --> RuntimeSpec
  ServerRuntime --> Rcon
  ServerRuntime --> Event
  LogWatcher --> LogLine
  LogWatcher --> Event
  MetricsSampler --> Event

  SchedulerTick --> BackupWorker
  SchedulerTick --> BackupConfig
  BackupWorker --> Backups
  BackupWorker --> Servers
  RestartTick --> RestartWorker
  RestartTick --> Server
  RestartWorker --> Servers
  RestartWorker --> Runtime
  BackupWorker --> ObanJob
  SchedulerTick --> ObanJob
  RestartTick --> ObanJob
  RestartWorker --> ObanJob
```

## HTTP and WebSocket interface

All routes under `/api/servers`, `/api/backups`, `/api/system`, and `/api/auth/me` pass through `ApiAuth`. Public routes are marked explicitly.

```mermaid
flowchart LR
  client["React API client"] --> endpoint["Phoenix Endpoint"]
  endpoint --> public["Public pipeline"]
  endpoint --> auth["API + ApiAuth pipeline"]

  public --> health["GET /health\nHealthController.show"]
  public --> authPublic["GET /api/auth/status\nPOST /api/auth/setup\nPOST /api/auth/login\nAuthController"]
  public --> spa["GET /*path\nSPAController.index"]

  auth --> authMe["GET /api/auth/me\nAuthController.me"]
  auth --> serverCrud["GET, POST /api/servers\nGET, PATCH, DELETE /api/servers/:id\nServerController"]
  auth --> migration["POST /api/servers/:id/migrate\nServerController"]
  auth --> lifecycle["POST start, stop, kill, command\nGET logs, status\nServerLifecycleController"]
  auth --> config["GET, PATCH /api/servers/:id/config\nServerConfigController"]
  auth --> properties["GET, PUT properties and properties/raw\nServerPropertiesController"]
  auth --> icon["POST, GET, DELETE /api/servers/:id/icon\nServerIconController"]
  auth --> files["list, read, write, mkdir, rename\ndownload, upload, delete\nServerFileController"]
  auth --> backup["list, create, configure, restore\ndownload, delete\nBackupController"]
  auth --> importRoutes["analyze and execute import\nImportController"]
  auth --> system["server types, versions, info\nJava versions and refresh\nSystemController"]

  socketClient["Phoenix JS Socket"] -->|"token"| userSocket["/socket\nUserSocket.connect"]
  userSocket -->|"server:<server_id>"| channel["ServerChannel.join"]
  channel --> events["status, log, metrics events"]
```

### Complete route catalog

| Authentication | Method | Path | Handler |
|---|---|---|---|
| Public | GET | `/health` | `HealthController.show` |
| Public | GET | `/api/auth/status` | `AuthController.status` |
| Public | POST | `/api/auth/setup` | `AuthController.setup` |
| Public | POST | `/api/auth/login` | `AuthController.login` |
| Required | GET | `/api/auth/me` | `AuthController.me` |
| Required | GET | `/api/servers` | `ServerController.index` |
| Required | POST | `/api/servers` | `ServerController.create` |
| Required | GET | `/api/servers/:id` | `ServerController.show` |
| Required | PATCH | `/api/servers/:id` | `ServerController.update` |
| Required | DELETE | `/api/servers/:id` | `ServerController.delete` |
| Required | POST | `/api/servers/:id/migrate` | `ServerController.migrate` |
| Required | GET | `/api/servers/:id/config` | `ServerConfigController.show` |
| Required | PATCH | `/api/servers/:id/config` | `ServerConfigController.update` |
| Required | GET | `/api/servers/:id/properties` | `ServerPropertiesController.show` |
| Required | PUT | `/api/servers/:id/properties` | `ServerPropertiesController.update` |
| Required | GET | `/api/servers/:id/properties/raw` | `ServerPropertiesController.show_raw` |
| Required | PUT | `/api/servers/:id/properties/raw` | `ServerPropertiesController.update_raw` |
| Required | POST | `/api/servers/:id/start` | `ServerLifecycleController.start` |
| Required | POST | `/api/servers/:id/stop` | `ServerLifecycleController.stop` |
| Required | POST | `/api/servers/:id/kill` | `ServerLifecycleController.kill` |
| Required | POST | `/api/servers/:id/command` | `ServerLifecycleController.command` |
| Required | GET | `/api/servers/:id/logs` | `ServerLifecycleController.logs` |
| Required | GET | `/api/servers/:id/status` | `ServerLifecycleController.status` |
| Required | POST | `/api/servers/:id/icon` | `ServerIconController.create` |
| Required | GET | `/api/servers/:id/icon` | `ServerIconController.show` |
| Required | DELETE | `/api/servers/:id/icon` | `ServerIconController.delete` |
| Required | POST | `/api/servers/:id/files/list` | `ServerFileController.list` |
| Required | GET | `/api/servers/:id/files/read/*path` | `ServerFileController.read` |
| Required | PUT | `/api/servers/:id/files/write/*path` | `ServerFileController.write` |
| Required | POST | `/api/servers/:id/files/mkdir/*path` | `ServerFileController.mkdir` |
| Required | POST | `/api/servers/:id/files/rename` | `ServerFileController.rename` |
| Required | GET | `/api/servers/:id/files/download/*path` | `ServerFileController.download` |
| Required | POST | `/api/servers/:id/files/upload` | `ServerFileController.upload` |
| Required | DELETE | `/api/servers/:id/files/*path` | `ServerFileController.delete` |
| Required | GET | `/api/backups/:serverId` | `BackupController.index` |
| Required | POST | `/api/backups/:serverId` | `BackupController.create` |
| Required | PATCH | `/api/backups/:serverId/config` | `BackupController.update_config` |
| Required | POST | `/api/backups/:server_id/import/analyze` | `ImportController.analyze` |
| Required | POST | `/api/backups/:server_id/import/:import_id/execute` | `ImportController.execute` |
| Required | POST | `/api/backups/:serverId/:backupId/restore` | `BackupController.restore` |
| Required | GET | `/api/backups/:serverId/:backupId/download` | `BackupController.download` |
| Required | DELETE | `/api/backups/:serverId/:backupId` | `BackupController.delete` |
| Required | GET | `/api/system/server-types` | `SystemController.server_types` |
| Required | GET | `/api/system/versions/:type` | `SystemController.versions` |
| Required | GET | `/api/system/info` | `SystemController.info` |
| Required | GET | `/api/system/java-versions` | `SystemController.java_versions` |
| Required | POST | `/api/system/java-versions/refresh` | `SystemController.refresh_java_versions` |
| Public | GET | `/*path` | `SPAController.index` |

WebSocket transport: `/socket/websocket`. Topic: `server:<server_id>`. Server-pushed events: `status`, `log`, and `metrics`.

## Worker and scheduling model

```mermaid
flowchart TB
  cron["Oban.Plugins.Cron\nevery minute"]

  cron --> backupTick["Backups.SchedulerTick\nqueue: backups"]
  backupTick --> enabledConfigs["Load enabled BackupConfig rows"]
  enabledConfigs --> dueBackup{"Interval due and players online?"}
  dueBackup -->|"yes"| backupJob["Backups.BackupWorker\nqueue: backups\nunique 55s\nmax attempts 3"]
  dueBackup -->|"no"| skipBackup["Skip"]
  backupJob --> createBackup["Backups.create_backup"]
  createBackup --> save["RCON save-off and save-all"]
  createBackup --> tar["tar.gz archive"]
  createBackup --> retention["Retention cleanup"]
  createBackup --> saveOn["RCON save-on"]

  cron --> restartTick["Servers.RestartTick\nqueue: restarts"]
  restartTick --> scheduledServers["Load servers with restart_schedule"]
  scheduledServers --> cronMatch{"Cron matches current minute?"}
  cronMatch -->|"yes"| restartJob["Servers.RestartWorker\nqueue: restarts\nunique 55s\nmax attempts 1"]
  cronMatch -->|"no"| skipRestart["Skip"]
  restartJob --> running{"Runtime state is running?"}
  running -->|"yes"| stop["Graceful stop"]
  stop --> await["Await terminal state"]
  await --> start["Start with fresh persisted spec"]
  running -->|"no"| skipRunning["Skip"]

  pruner["Oban.Plugins.Pruner"] --> oldJobs["Delete jobs older than 7 days"]
```

## Persistence model

```mermaid
erDiagram
  USERS {
    uuid id PK
    string username UK
    string hashed_password
    utc_datetime inserted_at
    utc_datetime updated_at
  }

  USERS_TOKENS {
    uuid id PK
    uuid user_id FK
    binary token
    string context
    utc_datetime inserted_at
  }

  SERVERS {
    uuid id PK
    string name
    string type
    string version
    integer port UK
    integer ram_min_mb
    integer ram_max_mb
    string java_version
    string directory
    boolean auto_start
    boolean auto_restart
    integer restart_limit
    string icon_path
    text jvm_args
    string java_path
    string restart_schedule
    integer rcon_port UK
    string rcon_password
    utc_datetime inserted_at
    utc_datetime updated_at
  }

  BACKUP_CONFIGS {
    uuid id PK
    uuid server_id FK,UK
    boolean enabled
    integer interval_minutes
    integer max_backups
    boolean include_logs
    utc_datetime inserted_at
    utc_datetime updated_at
  }

  BACKUPS {
    uuid id PK
    uuid server_id FK
    string filename
    bigint size_bytes
    string type
    string status
    utc_datetime inserted_at
  }

  OBAN_JOBS {
    bigint id PK
    string state
    string queue
    jsonb args
    string worker
    utc_datetime scheduled_at
  }

  USERS ||--o{ USERS_TOKENS : owns
  SERVERS ||--|| BACKUP_CONFIGS : configures
  SERVERS ||--o{ BACKUPS : has
```

Oban jobs reference server IDs inside JSON arguments rather than through database foreign keys.

## Filesystem model

```mermaid
flowchart TB
  data["DATA_DIR"]
  data --> serversDir["servers/"]
  data --> backupsDir["backups/"]
  data --> importsDir["imports/"]
  data --> jarsDir["jars/"]

  serversDir --> serverId["<server UUID>/"]
  serverId --> jar["server.jar"]
  serverId --> properties["server.properties"]
  serverId --> eula["eula.txt"]
  serverId --> worlds["world data"]
  serverId --> logs["logs/latest.log"]
  serverId --> plugins["plugins and configs"]

  backupsDir --> archive["<server UUID>_<timestamp>.tar.gz"]
  importsDir --> importSession["temporary import session"]
  jarsDir --> cache["downloaded server JAR cache"]

  pathSandbox["Files.PathSandbox"] --> serverId
  logWatcher["Runtime.LogWatcher"] --> logs
  backupContext["Backups"] --> archive
  importContext["Imports"] --> importSession
  jarCache["Minecraft.JarCache"] --> cache
```

## Frontend module map

```mermaid
flowchart TB
  main["main.tsx"] --> providers["AppProviders\nQueryClientProvider"]
  providers --> app["App.tsx\nRouter and auth gate"]

  app --> setup["SetupPage"]
  app --> login["LoginPage"]
  app --> serversPage["ServersPage"]
  app --> createPage["CreateServerPage"]
  app --> detail["ServerDetailPage"]
  app --> notFound["NotFoundPage"]

  serversPage --> serverCard["ServerCard"]
  detail --> console["ConsoleView"]
  detail --> backupList["BackupList"]
  detail --> fileBrowser["FileBrowser"]
  detail --> settings["ServerSettingsTab"]

  fileBrowser --> fileTree["FileTree"]
  fileBrowser --> fileEditor["FileEditor"]
  fileBrowser --> uploader["FileUploader"]
  fileBrowser --> breadcrumb["FileBreadcrumb"]

  backupList --> importDialog["ImportDialog"]
  importDialog --> dropZone["ImportDropZone"]
  importDialog --> suggestion["ImportSuggestion"]
  importDialog --> manualSelection["ImportManualSelection"]

  settings --> metadata["MetadataSection"]
  settings --> game["GameSettingsSection"]
  settings --> resources["ResourcesSection"]
  settings --> version["VersionSection"]
  settings --> automation["AutomationSection"]
  settings --> backupSettings["BackupSection"]

  subgraph state["Client state and communication"]
    authStore["authStore\ntoken and session"]
    wsStore["webSocketStore\nSocket and channel"]
    uiStore["uiStore"]
    hooks["Feature hooks\nTanStack Query and mutations"]
    api["lib/api.ts\nREST fetch functions"]
    queryClient["queryClient and queryKeys"]
    phoenix["Phoenix JS client"]
    hooks --> api
    hooks --> queryClient
    wsStore --> phoenix
    wsStore --> queryClient
  end

  setup --> authStore
  login --> authStore
  serversPage --> hooks
  createPage --> hooks
  console --> wsStore
  console --> hooks
  backupList --> hooks
  fileBrowser --> api
  settings --> hooks

  api --> rest["Phoenix REST API"]
  phoenix --> channel["Phoenix ServerChannel"]
```

### Frontend hooks by backend capability

| Frontend hook/store | Capability | Backend boundary |
|---|---|---|
| `authStore` | Setup, login, session validation | `AuthController` |
| `useServers`, `useServer` | Server queries | `ServerController` |
| `useServerActions` | Create, start, stop, delete | `ServerController`, `ServerLifecycleController` |
| `useServerConfig` | Metadata, resources, automation, icons | `ServerConfigController`, `ServerIconController` |
| `useServerProperties` | Parsed properties | `ServerPropertiesController` |
| `useBackups` | Backup CRUD, restore, configuration | `BackupController` |
| `useImport` | Upload analysis and import execution | `ImportController` |
| `useMinecraftVersions` | Server versions | `SystemController` |
| `useJavaVersions` | Java discovery and refresh | `SystemController` |
| `useVersionMigration` | Type and version migration | `ServerController.migrate` |
| `useWebSocket`, `webSocketStore` | Logs, metrics, status | `UserSocket`, `ServerChannel` |

## Main end-to-end flows

### Start a server

```mermaid
sequenceDiagram
  actor User
  participant UI as React UI
  participant API as ServerLifecycleController
  participant Servers as Allay.Servers
  participant Bridge as RuntimeBridge
  participant Runtime as Allay.Runtime
  participant GenServer as ServerRuntime
  participant Java as Minecraft JVM
  participant Channel as ServerChannel

  User->>UI: Start
  UI->>API: POST /api/servers/:id/start
  API->>Servers: start_server(scope, id)
  Servers->>Bridge: build_spec(server)
  Bridge-->>Servers: Runtime.Spec
  Servers->>Runtime: start_server(spec)
  Runtime->>GenServer: start InstanceSupervisor subtree
  GenServer->>Java: spawn via Erlang Port
  API-->>UI: starting status
  loop Until ready or timeout
    GenServer->>Java: RCON probe
  end
  Java-->>GenServer: authenticated RCON connection
  GenServer-->>Channel: PubSub status running
  Channel-->>UI: status event
```

### Scheduled backup

```mermaid
sequenceDiagram
  participant Cron as Oban Cron
  participant Tick as SchedulerTick
  participant DB as PostgreSQL
  participant Worker as BackupWorker
  participant Runtime as Allay.Runtime
  participant Backup as Allay.Backups
  participant FS as DATA_DIR

  Cron->>Tick: enqueue every minute
  Tick->>DB: load enabled backup configs
  Tick->>Runtime: player_count(server_id)
  Tick->>Worker: enqueue due server
  Worker->>Backup: create_backup(system scope)
  Backup->>Runtime: save-off and save-all
  Backup->>DB: insert pending backup
  Backup->>FS: create tar.gz
  Backup->>DB: mark completed or failed
  Backup->>DB: apply retention
  Backup->>Runtime: save-on
```

### Real-time console

```mermaid
sequenceDiagram
  participant JVM as Minecraft JVM
  participant Watcher as LogWatcher
  participant PubSub as Phoenix.PubSub
  participant Channel as ServerChannel
  participant Store as webSocketStore
  participant Console as ConsoleView

  JVM->>Watcher: append logs/latest.log
  Watcher->>PubSub: Event log
  PubSub->>Channel: Event
  Channel->>Store: push log
  Store->>Console: onLog callback
  Console-->>Console: append rendered log line
```

## Architectural ownership summary

| Concern | Owner |
|---|---|
| HTTP routing and authentication | `AllayWeb.Router`, `AllayWeb.Plugs.ApiAuth` |
| WebSocket authentication and authorization | `AllayWeb.UserSocket`, `AllayWeb.ServerChannel` |
| User accounts and API tokens | `Allay.Accounts` |
| Persisted server lifecycle and configuration | `Allay.Servers` |
| JVM process lifecycle and runtime state | `Allay.Runtime`, `Allay.Runtime.ServerRuntime` |
| Java installation discovery | `Allay.Servers.JavaRegistry` |
| Minecraft metadata and protocol helpers | `Allay.Minecraft.*` |
| Backup archive lifecycle | `Allay.Backups` |
| Scheduled work | Oban workers and cron plugins |
| Sandboxed server file access | `Allay.Files`, `Allay.Files.PathSandbox` |
| Import analysis and extraction | `Allay.Imports.*` |
| Relational persistence | `Allay.Repo`, Ecto schemas, PostgreSQL |
| Client server-state cache | TanStack Query |
| Client session and socket state | Zustand stores |
| Live status, logs, and metrics | Phoenix PubSub and Channels |
