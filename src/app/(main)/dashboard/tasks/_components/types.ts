export interface MemberOption {
  id: string;
  name: string;
  email: string;
}

export interface PaginationInfo {
  page: number;
  per_page: number;
  total_entries: number;
  total_pages: number;
}
