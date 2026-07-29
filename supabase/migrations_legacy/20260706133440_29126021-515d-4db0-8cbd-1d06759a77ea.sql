GRANT EXECUTE ON FUNCTION public.get_daily_team_month_summary(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_team_report(uuid, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_public_info(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_roster(uuid) TO anon, authenticated;