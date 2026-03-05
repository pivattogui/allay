package server

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

func (s *Server) handleBackupCreate(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "serverID")
	if !isValidID(serverID) {
		jsonError(w, http.StatusBadRequest, "invalid server id")
		return
	}

	info, err := s.backupMgr.Create(serverID)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	jsonResponse(w, http.StatusCreated, info)
}

func (s *Server) handleBackupList(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "serverID")
	if !isValidID(serverID) {
		jsonError(w, http.StatusBadRequest, "invalid server id")
		return
	}

	backups, err := s.backupMgr.List(serverID)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, backups)
}

func (s *Server) handleBackupRestore(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "serverID")
	backupID := chi.URLParam(r, "backupID")
	if !isValidID(serverID) || !isValidID(backupID) {
		jsonError(w, http.StatusBadRequest, "invalid server or backup id")
		return
	}

	status, _ := s.procMgr.GetStatus(serverID)
	if status != nil && status.State == "running" {
		jsonError(w, http.StatusConflict, "server must be stopped before restoring a backup")
		return
	}

	if err := s.backupMgr.Restore(serverID, backupID); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{"status": "restored"})
}

func (s *Server) handleBackupDelete(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "serverID")
	backupID := chi.URLParam(r, "backupID")
	if !isValidID(serverID) || !isValidID(backupID) {
		jsonError(w, http.StatusBadRequest, "invalid server or backup id")
		return
	}

	if err := s.backupMgr.Delete(backupID); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}
