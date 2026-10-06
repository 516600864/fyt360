import { createRouter, createWebHashHistory } from 'vue-router';
import Login from './views/login/index.vue';
import Dashboard from './views/dashboard/index.vue';
import SelectSite from './views/select-site/index.vue';

const router = createRouter({
  // hash 路由：静态托管无 history 回退（/admin/login 直达 404），hash 模式不受影响
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/login', component: Login },
    { path: '/select-site', component: SelectSite, meta: { requiresAuth: true } },
    { path: '/', component: Dashboard, meta: { requiresAuth: true } },
  ],
});

router.beforeEach((to) => {
  if (to.meta.requiresAuth && !localStorage.getItem('fyt_admin_token')) {
    return '/login';
  }
});

export default router;
