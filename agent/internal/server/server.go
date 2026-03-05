package server

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/allaymc/agent/internal/auth"
	"github.com/allaymc/agent/internal/backup"
	"github.com/allaymc/agent/internal/files"
	"github.com/allaymc/agent/internal/jar"
	"github.com/allaymc/agent/internal/metrics"
	"github.com/allaymc/agent/internal/process"
	"github.com/allaymc/agent/internal/rcon"
	"github.com/allaymc/agent/pkg/types"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type Server struct {
	cfg       *types.Config
	router    chi.Router
	procMgr   *process.Manager
	rconMgr   *rcon.Manager
	backupMgr *backup.Manager
	fileMgr   *files.Manager
	jarMgr    *jar.Manager
	logger    *slog.Logger
	httpSrv   *http.Server
}

func New(
	cfg *types.Config,
	procMgr *process.Manager,
	rconMgr *rcon.Manager,
	backupMgr *backup.Manager,
	fileMgr *files.Manager,
	jarMgr *jar.Manager,
	logger *slog.Logger,
) *Server {
	s := &Server{
		cfg:       cfg,
		procMgr:   procMgr,
		rconMgr:   rconMgr,
		backupMgr: backupMgr,
		fileMgr:   fileMgr,
		jarMgr:    jarMgr,
		logger:    logger,
	}

	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(middleware.RealIP)
	r.Use(middleware.Timeout(60 * time.Second))

	// Health endpoint outside auth
	r.Get("/health", s.handleHealth)

	// All other routes require auth
	r.Group(func(r chi.Router) {
		r.Use(auth.TokenMiddleware(cfg.Token))
		s.registerRoutes(r)
	})
	s.router = r

	return s
}

func (s *Server) Start() error {
	addr := fmt.Sprintf(":%d", s.cfg.Port)
	s.httpSrv = &http.Server{
		Addr:    addr,
		Handler: s.router,
	}
	s.logger.Info("HTTP server starting", "addr", addr)
	return s.httpSrv.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpSrv.Shutdown(ctx)
}

func (s *Server) registerRoutes(r chi.Router) {
	r.Get("/system/resources", s.handleSystemResources)
	r.Get("/system/info", s.handleSystemInfo)

	r.Route("/servers", func(r chi.Router) {
		r.Post("/", s.handleProvision)

		r.Route("/{serverID}", func(r chi.Router) {
			r.Delete("/", s.handleDeprovision)
			r.Post("/start", s.handleStart)
			r.Post("/stop", s.handleStop)
			r.Post("/kill", s.handleKill)
			r.Post("/restart", s.handleRestart)
			r.Post("/command", s.handleCommand)
			r.Get("/status", s.handleStatus)
			r.Get("/logs", s.handleLogs)

			r.Get("/files", s.handleFileList)
			r.Get("/files/*", s.handleFileRead)
			r.Put("/files/*", s.handleFileWrite)
			r.Delete("/files/*", s.handleFileDelete)

			r.Post("/backups", s.handleBackupCreate)
			r.Get("/backups", s.handleBackupList)
			r.Post("/backups/{backupID}/restore", s.handleBackupRestore)
			r.Delete("/backups/{backupID}", s.handleBackupDelete)
		})
	})

	r.Get("/jars/versions/{type}", s.handleJarVersions)
	r.Post("/jars/download", s.handleJarDownload)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleSystemResources(w http.ResponseWriter, r *http.Request) {
	res := metrics.GetSystemResources()
	jsonResponse(w, http.StatusOK, res)
}

func (s *Server) handleSystemInfo(w http.ResponseWriter, r *http.Request) {
	info := getSystemInfo()
	jsonResponse(w, http.StatusOK, info)
}
