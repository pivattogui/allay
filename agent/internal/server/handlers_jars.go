package server

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

func (s *Server) handleJarVersions(w http.ResponseWriter, r *http.Request) {
	serverType := chi.URLParam(r, "type")
	if !isValidServerType(serverType) {
		jsonError(w, http.StatusBadRequest, "invalid server type, must be 'vanilla' or 'paper'")
		return
	}

	versions, err := s.jarMgr.GetVersions(serverType)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, versions)
}

func (s *Server) handleJarDownload(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Type    string `json:"type"`
		Version string `json:"version"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Type == "" || req.Version == "" {
		jsonError(w, http.StatusBadRequest, "type and version are required")
		return
	}
	if !isValidServerType(req.Type) {
		jsonError(w, http.StatusBadRequest, "invalid server type, must be 'vanilla' or 'paper'")
		return
	}
	if !isValidVersion(req.Version) {
		jsonError(w, http.StatusBadRequest, "invalid version format")
		return
	}

	if err := s.jarMgr.Download(req.Type, req.Version); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{"status": "downloaded"})
}
