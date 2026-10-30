// src/i18n/vi.ts
// All Vietnamese UI strings for the USCC Referee Results Web application.
// Every user-visible Vietnamese text must come from this file (AGENT_PROMPT.md §1.3, CLAUDE.md §2).
// Wording that the SRS fixes verbatim (e.g. SRS-SM-10, SRS-CONF-04) is cited next to the key.

/**
 * Vietnamese UI string catalogue, organised by feature area.
 * Values are plain strings or functions returning strings.
 */
export const vi = {
  common: {
    appName: "USCC — Ghi kết quả giải đấu",
    save: "Lưu",
    cancel: "Hủy",
    confirm: "Xác nhận",
    edit: "Sửa",
    back: "Quay lại",
    loading: "Đang tải…",
    error: "Có lỗi xảy ra",
    success: "Thành công",
    required: "Bắt buộc",
    optional: "Tùy chọn",
    yes: "Có",
    no: "Không",
    noData: "Không có dữ liệu",
    search: "Tìm kiếm",
    actions: "Thao tác",
    status: "Trạng thái",
    createdAt: "Ngày tạo",
    /** @param count - Number of actions still waiting in the offline queue (SRS-SYNC-02). */
    unsyncedBadge: (count: number) => `Chưa đồng bộ (${count})`,
  },

  auth: {
    loginTitle: "Đăng nhập",
    loginSubtitle: "Hệ thống ghi kết quả giải đấu cờ vua USCC — chỉ dành cho trọng tài",
    usernameLabel: "Tên đăng nhập",
    usernamePlaceholder: "Nhập tên đăng nhập",
    passwordLabel: "Mật khẩu",
    passwordPlaceholder: "Nhập mật khẩu",
    loginButton: "Đăng nhập",
    loggingIn: "Đang đăng nhập…",
    logoutButton: "Đăng xuất",
    loginError: "Tên đăng nhập hoặc mật khẩu không đúng.",
    accountInactiveError: "Tài khoản đã bị vô hiệu hóa. Liên hệ trọng tài kỹ thuật.",
    sessionExpiredError: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
    loginRequired: "Vui lòng đăng nhập để tiếp tục.",
    forbidden: "Bạn không có quyền thực hiện thao tác này.",
    crossOriginRejected: "Yêu cầu không hợp lệ (sai nguồn gốc).",
  },

  roles: {
    TECHNICAL: "Trọng tài kỹ thuật",
    RECORDER: "Trọng tài ghi kết quả",
  },

  nav: {
    home: "Trang chủ",
    tournaments: "Giải đấu",
    users: "Tài khoản",
    signedInAs: (username: string, roleLabel: string) => `${username} · ${roleLabel}`,
  },

  home: {
    pageTitle: "Giải đấu",
    noTournaments: "Chưa có giải đấu nào.",
    roundLink: (roundNumber: number) => `Vòng ${roundNumber}`,
    dateRange: (startDate: string, endDate: string) => `${startDate} – ${endDate}`,
    noRounds: "Chưa có vòng đấu nào.",
  },

  adminUsers: {
    pageTitle: "Quản lý tài khoản",
    createUser: "Tạo tài khoản",
    createUserHeading: "Tạo tài khoản mới",
    usernameLabel: "Tên đăng nhập",
    usernameHint: "3–40 ký tự: chữ thường không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang.",
    passwordLabel: "Mật khẩu",
    roleLabel: "Vai trò",
    activateUser: "Kích hoạt lại",
    deactivateUser: "Vô hiệu hóa",
    resetPassword: "Đặt lại mật khẩu",
    newPasswordPrompt: (username: string) => `Mật khẩu mới cho ${username}:`,
    deactivateConfirm: (username: string) =>
      `Vô hiệu hóa tài khoản ${username}? Mọi phiên đăng nhập của tài khoản này sẽ kết thúc ngay.`,
    isActiveOn: "Đang hoạt động",
    isActiveOff: "Đã vô hiệu hóa",
    createSuccess: "Đã tạo tài khoản.",
    deactivateSuccess: "Đã vô hiệu hóa tài khoản.",
    activateSuccess: "Đã kích hoạt lại tài khoản.",
    resetPasswordSuccess: "Đã đặt lại mật khẩu. Các phiên đăng nhập cũ đã kết thúc.",
    usernameTaken: "Tên đăng nhập đã tồn tại.",
    lastTechnicalAccount: "Không thể vô hiệu hóa tài khoản trọng tài kỹ thuật cuối cùng đang hoạt động.",
    cannotDeactivateSelf: "Bạn không thể tự vô hiệu hóa tài khoản của mình.",
    userNotFound: "Không tìm thấy tài khoản.",
    noUsers: "Chưa có tài khoản nào.",
    tableHeaderUsername: "Tên đăng nhập",
    tableHeaderRole: "Vai trò",
    tableHeaderStatus: "Trạng thái",
    tableHeaderCreatedAt: "Ngày tạo",
    tableHeaderActions: "Thao tác",
  },

  resultStatus: {
    NONE: "Chưa có kết quả",
    PENDING: "Chờ xác nhận",
    DISPUTED: "Có bất đồng",
    OFFICIAL: "Chính thức",
    REOPENED: "Đã mở lại",
  },

  /** Labels for the proposed default result codes (SRS-TOUR-06; final list is open question OI-03). */
  defaultResultCodeLabels: {
    whiteWins: "Trắng thắng",
    blackWins: "Đen thắng",
    draw: "Hòa",
    whiteWinsByForfeit: "Trắng thắng do Đen bỏ cuộc",
    blackWinsByForfeit: "Đen thắng do Trắng bỏ cuộc",
    doubleForfeit: "Cả hai bỏ cuộc",
    fullPointBye: "Miễn đấu (1 điểm)",
    halfPointBye: "Miễn đấu (½ điểm)",
    zeroPointBye: "Miễn đấu (0 điểm)",
  },

  record: {
    submitToPlayers: "Gửi cho kỳ thủ xác nhận",
    confirmButton: "Xác nhận",
    rejectButton: "Không đồng ý",
    // SRS-CONF-04: reminder shown on every confirmation step.
    reminderCheckPlayer: "Trọng tài kiểm tra đúng người trước khi đưa máy",
  },

  apiErrors: {
    invalidInput: "Dữ liệu không hợp lệ.",
    notFound: "Không tìm thấy dữ liệu.",
    // SRS-SM-10: exact message for a stale optimistic-lock version.
    versionConflict: "Kết quả đã thay đổi. Vui lòng tải lại.",
    idempotencyKeyRequired: "Thiếu khóa Idempotency-Key cho thao tác này.",
    idempotencyKeyReused: "Khóa Idempotency-Key đã được dùng cho một yêu cầu khác.",
    serverError: "Lỗi máy chủ. Vui lòng thử lại sau.",
  },

  validation: {
    required: "Trường này là bắt buộc.",
    minLength: (min: number) => `Tối thiểu ${min} ký tự.`,
    maxLength: (max: number) => `Tối đa ${max} ký tự.`,
    invalidFormat: "Định dạng không hợp lệ.",
    passwordTooShort: (min: number) => `Mật khẩu phải có ít nhất ${min} ký tự.`,
  },

  errors: {
    notFound: "Không tìm thấy trang.",
    forbiddenTitle: "Không có quyền truy cập",
    forbidden: "Tài khoản của bạn không có quyền mở trang này.",
    goHome: "Về trang chủ",
  },
} as const;

/** Type of the Vietnamese string catalogue. */
export type Vi = typeof vi;
