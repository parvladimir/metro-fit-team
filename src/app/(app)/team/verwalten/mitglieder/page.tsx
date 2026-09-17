import { BackLink } from '@/components/ui/BackLink';
import { requireTeamAdminMembership } from '@/lib/data/admin';
import { getTeamRoster } from '@/lib/data/team';
import { setMemberRoleAction, removeMemberAction } from './actions';
import { ConfirmSubmitButton } from '@/components/ui/ConfirmSubmitButton';
import { Avatar } from '@/components/ui/Avatar';
import { t } from '@/lib/i18n';

export default async function MitgliederPage() {
  const admin = await requireTeamAdminMembership();
  const roster = await getTeamRoster(admin.team_id);

  return (
    <div className="screen-padding flex flex-col gap-4 pb-4">
      <div className="flex items-center gap-3">
        <BackLink href="/team/verwalten" />
        <h1 className="text-xl font-bold text-neutral-900">{t('admin.members')}</h1>
      </div>

      <div className="flex flex-col gap-2.5">
        {roster.map((member) => (
          <div key={member.id} className="card flex flex-col gap-3 py-3.5">
            <div className="flex items-center gap-3">
              <Avatar src={member.profile.avatar_url} name={member.profile.full_name} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-neutral-900">{member.profile.full_name}</p>
                <p className="text-xs text-neutral-500">{t(`admin.role.${member.role}` as const)}</p>
              </div>
            </div>

            {member.user_id !== admin.user_id && (
              <div className="flex gap-2">
                <form action={setMemberRoleAction.bind(null, member.id, member.user_id, member.role === 'team_admin' ? 'member' : 'team_admin')} className="flex-1">
                  <button type="submit" className="btn-ghost w-full bg-neutral-100 px-3 py-2 text-xs">
                    {member.role === 'team_admin' ? t('admin.removeAdmin') : t('admin.makeAdmin')}
                  </button>
                </form>
                <form action={removeMemberAction.bind(null, member.id, member.user_id)} className="flex-1">
                  <ConfirmSubmitButton
                    className="btn-destructive w-full px-3 py-2 text-xs"
                    confirmMessage={t('admin.removeMember.confirm', { name: member.profile.full_name || '' })}
                  >
                    {t('admin.removeMember')}
                  </ConfirmSubmitButton>
                </form>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
