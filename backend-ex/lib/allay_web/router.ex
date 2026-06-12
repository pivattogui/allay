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

    post "/:id/start", ServerLifecycleController, :start
    post "/:id/stop", ServerLifecycleController, :stop
    post "/:id/kill", ServerLifecycleController, :kill
    post "/:id/command", ServerLifecycleController, :command
    get "/:id/logs", ServerLifecycleController, :logs
    get "/:id/status", ServerLifecycleController, :status

    post "/:id/icon", ServerIconController, :create
    get "/:id/icon", ServerIconController, :show
    delete "/:id/icon", ServerIconController, :delete
  end

  scope "/api/system", AllayWeb do
    pipe_through [:api, :authenticated]

    get "/server-types", SystemController, :server_types
    get "/versions/:type", SystemController, :versions
    get "/info", SystemController, :info
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

  scope "/", AllayWeb do
    get "/*path", SPAController, :index
  end
end
