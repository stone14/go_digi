package config

import (
	"encoding/json"
	"fmt"
	"os"
)

type Config struct {
	Port string   `json:"port"`
	DB   DBConfig `json:"db"`
}

type DBConfig struct {
	Host     string `json:"host"`
	Port     string `json:"port"`
	User     string `json:"user"`
	Password string `json:"password"`
	Database string `json:"database"`
	MaxConns int    `json:"max_conns"`
}

func (d DBConfig) DSN() string {
	return fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable",
		d.User, d.Password, d.Host, d.Port, d.Database)
}

// Load는 환경변수 → config.json 순서로 설정을 로드합니다.
func Load() (*Config, error) {
	cfg := &Config{
		Port: "3200",
		DB: DBConfig{
			Host:     "localhost",
			Port:     "5432",
			User:     "argus",
			Password: "argus",
			Database: "argus",
			MaxConns: 20,
		},
	}

	// config.json이 있으면 로드
	if data, err := os.ReadFile("config.json"); err == nil {
		if err := json.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("config.json 파싱 실패: %w", err)
		}
	}

	// 환경변수 오버라이드
	if v := os.Getenv("PORT"); v != "" {
		cfg.Port = v
	}
	if v := os.Getenv("DB_HOST"); v != "" {
		cfg.DB.Host = v
	}
	if v := os.Getenv("DB_PORT"); v != "" {
		cfg.DB.Port = v
	}
	if v := os.Getenv("DB_USER"); v != "" {
		cfg.DB.User = v
	}
	if v := os.Getenv("DB_PASSWORD"); v != "" {
		cfg.DB.Password = v
	}
	if v := os.Getenv("DB_NAME"); v != "" {
		cfg.DB.Database = v
	}

	return cfg, nil
}
