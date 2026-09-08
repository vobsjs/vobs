import { authPlugin, createAuth } from '@vobs/auth'
import { state } from '@vobs/vobs'

export const auth = createAuth({
  session: state({ user: { id: 'playground', roles: ['maintainer'], permissions: ['users.read'] } }, 'auth.session'),
  loginHandler: async credentials => {
    await new Promise<void>(resolve => setTimeout(resolve, 260))
    const username = String(credentials.username ?? '').trim()
    if (!username) throw new Error('请输入用户名')
    return {
      user: {
        id: username,
        roles: username === 'admin' ? ['maintainer', 'admin'] : ['maintainer'],
        permissions: username === 'admin' ? ['users.read', 'users.write'] : ['users.read']
      }
    }
  }
})

export const authPluginInstance = authPlugin({ auth })
