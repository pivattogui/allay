defmodule AllayWeb.Router do
  use AllayWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  pipeline :authenticated do
    plug AllayWeb.Plugs.ApiAuth
  end

  scope "/", AllayWeb do
    pipe_through :api

    get "/health", HealthController, :show
  end

  scope "/api/auth", AllayWeb do
    pipe_through :api

    get "/status", AuthController, :status
    post "/setup", AuthController, :setup
    post "/login", AuthController, :login
  end

  scope "/api/auth", AllayWeb do
    pipe_through [:api, :authenticated]

    get "/me", AuthController, :me
  end

  scope "/api/servers", AllayWeb do
    pipe_through [:api, :authenticated]

    get "/", ServerController, :index
    post "/", ServerController, :create
    get "/:id", ServerController, :show
    patch "/:id", ServerController, :update
    delete "/:id", ServerController, :delete

    get "/:id/config", ServerConfigController, :show
    patch "/:id/config", ServerConfigController, :update

    get "/:id/properties", ServerPropertiesController, :show
    put "/:id/properties", ServerPropertiesController, :update
    get "/:id/properties/raw", ServerPropertiesController, :show_raw
    put "/:id/properties/raw", ServerPropertiesController, :update_raw

    post "/:id/start", ServerLifecycleController, :start
    post "/:id/stop", ServerLifecycleController, :stop
    post "/:id/kill", ServerLifecycleController, :kill
    post "/:id/command", ServerLifecycleController, :command
    get "/:id/logs", ServerLifecycleController, :logs
    get "/:id/status", ServerLifecycleController, :status

    post "/:id/icon", ServerIconController, :create
    get "/:id/icon", ServerIconController, :show
    delete "/:id/icon", ServerIconController, :delete

    post "/:id/migrate", ServerController, :migrate

    post "/:id/files/list", ServerFileController, :list
    get "/:id/files/read/*path", ServerFileController, :read
    put "/:id/files/write/*path", ServerFileController, :write
    post "/:id/files/mkdir/*path", ServerFileController, :mkdir
    post "/:id/files/rename", ServerFileController, :rename
    get "/:id/files/download/*path", ServerFileController, :download
    post "/:id/files/upload", ServerFileController, :upload
    delete "/:id/files/*path", ServerFileController, :delete
  end

  scope "/api/backups", AllayWeb do
    pipe_through [:api, :authenticated]

    get "/:serverId", BackupController, :index
    post "/:serverId", BackupController, :create
    patch "/:serverId/config", BackupController, :update_config

    post "/:server_id/import/analyze", ImportController, :analyze
    post "/:server_id/import/:import_id/execute", ImportController, :execute

    post "/:serverId/:backupId/restore", BackupController, :restore
    get "/:serverId/:backupId/download", BackupController, :download
    delete "/:serverId/:backupId", BackupController, :delete
  end

  scope "/api/system", AllayWeb do
    pipe_through [:api, :authenticated]

    get "/server-types", SystemController, :server_types
    get "/versions/:type", SystemController, :versions
    get "/info", SystemController, :info
    get "/java-versions", SystemController, :java_versions
    post "/java-versions/refresh", SystemController, :refresh_java_versions
  end

  # Enable LiveDashboard in development
  if Application.compile_env(:allay, :dev_routes) do
    # If you want to use the LiveDashboard in production, you should put
    # it behind authentication and allow only admins to access it.
    # If your application does not have an admins-only section yet,
    # you can use Plug.BasicAuth to set up some basic authentication
    # as long as you are also using SSL (which you should anyway).
    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through [:fetch_session, :protect_from_forgery]

      live_dashboard "/dashboard", metrics: AllayWeb.Telemetry
    end
  end
end
