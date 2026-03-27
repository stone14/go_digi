package auth

// RoleLevel은 역할의 권한 수준을 반환합니다.
func RoleLevel(role string) int {
	switch role {
	case "admin":
		return 2
	case "operator":
		return 1
	case "readonly":
		return 0
	default:
		return -1
	}
}
