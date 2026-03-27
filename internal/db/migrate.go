package db

import (
	"log/slog"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/stone14/go_digi/internal/config"
	"github.com/stone14/go_digi/migrations"
)

// RunMigrations는 내장된 SQL 파일로 DB 마이그레이션을 실행합니다.
func RunMigrations(cfg config.DBConfig) error {
	source, err := iofs.New(migrations.FS, ".")
	if err != nil {
		return err
	}

	m, err := migrate.NewWithSourceInstance("iofs", source, cfg.DSN())
	if err != nil {
		return err
	}
	defer m.Close()

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return err
	}

	version, dirty, _ := m.Version()
	slog.Info("마이그레이션 완료", "version", version, "dirty", dirty)
	return nil
}
