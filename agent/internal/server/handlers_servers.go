package server

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/allaymc/agent/pkg/types"
	"github.com/go-chi/chi/v5"
)

func (s *Server) handleProvision(w http.ResponseWriter, r *http.Request) {
	var req types.ProvisionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.ID == "" || req.Type == "" || req.Version == "" || req.Port == 0 {
		jsonError(w, http.StatusBadRequest, "id, type, version, and port are required")
		return
	}

	if !isValidID(req.ID) {
		jsonError(w, http.StatusBadRequest, "invalid server id format")
		return
	}
	if !isValidServerType(string(req.Type)) {
		jsonError(w, http.StatusBadRequest, "invalid server type")
		return
	}
	if !isValidVersion(req.Version) {
		jsonError(w, http.StatusBadRequest, "invalid version format")
		return
	}

	if err := s.procMgr.Provision(req, s.cfg.RCON); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	jsonResponse(w, http.StatusCreated, map[string]string{"status": "provisioned"})
}

func (s *Server) handleDeprovision(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "serverID")
	if !isValidID(serverID) {
		jsonError(w, http.StatusBadRequest, "invalid server id")
		return
	}

	if err := s.procMgr.Deprovision(serverID); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{"status": "removed"})
}

func (s *Server) handleStart(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "serverID")
	if !isValidID(serverID) {
		jsonError(w, http.StatusBadRequest, "invalid server id")
		return
	}

	resp, err := s.procMgr.Start(serverID)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, resp)
}

func (s *Server) handleStop(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "serverID")
	if !isValidID(serverID) {
		jsonError(w, http.StatusBadRequest, "invalid server id")
		return
	}

	go func() {
		if err := s.procMgr.Stop(serverID); err != nil {
			s.logger.Error("failed to stop server", "id", serverID, "error", err)
		}
	}()

	jsonResponse(w, http.StatusOK, map[string]string{"status": "stopping"})
}

func (s *Server) handleKill(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "serverID")
	if !isValidID(serverID) {
		jsonError(w, http.StatusBadRequest, "invalid server id")
		return
	}

	if err := s.procMgr.Kill(serverID); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{"status": "killed"})
}

func (s *Server) handleRestart(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "serverID")
	if !isValidID(serverID) {
		jsonError(w, http.StatusBadRequest, "invalid server id")
		return
	}

	go func() {
		if err := s.procMgr.Restart(serverID); err != nil {
			s.logger.Error("failed to restart server", "id", serverID, "error", err)
		}
	}()

	jsonResponse(w, http.StatusOK, map[string]string{"status": "restarting"})
}

func (s *Server) handleCommand(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "serverID")
	if !isValidID(serverID) {
		jsonError(w, http.StatusBadRequest, "invalid server id")
		return
	}

	var req types.CommandRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if s.rconMgr != nil && s.rconMgr.IsConnected(serverID) {
		resp, err := s.rconMgr.Execute(serverID, req.Command)
		if err == nil {
			jsonResponse(w, http.StatusOK, map[string]string{"response": resp})
			return
		}
		s.logger.Warn("RCON command failed, falling back to stdin", "error", err)
	}

	if err := s.procMgr.SendCommand(serverID, req.Command); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{"status": "sent"})
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "serverID")
	if !isValidID(serverID) {
		jsonError(w, http.StatusBadRequest, "invalid server id")
		return
	}

	status, err := s.procMgr.GetStatus(serverID)
	if err != nil {
		jsonError(w, http.StatusNotFound, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, status)
}

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "serverID")
	if !isValidID(serverID) {
		jsonError(w, http.StatusBadRequest, "invalid server id")
		return
	}
	lines := 100
	if v := r.URL.Query().Get("lines"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			lines = n
		}
	}
	if lines > 10000 {
		lines = 10000
	}

	logs, err := s.procMgr.GetLogs(serverID, lines)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{"lines": logs})
}
