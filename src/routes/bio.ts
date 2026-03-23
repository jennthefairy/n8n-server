import { Context } from 'hono';
import { airtableFetch, sanitizeParam } from '../lib/airtable.js';
import { htmlHead } from '../lib/render.js';

export async function renderBioPage(c: Context): Promise<Response> {
  const username = sanitizeParam(c.req.param('username') ?? '');
  const ref = sanitizeParam(c.req.query('ref') || '');

  const usersData = await airtableFetch('USERS', {
    filterByFormula: `OR({username}='${username}', LOWER({username})='${username.toLowerCase()}')`,
    maxRecords: 1,
  });
  const user = usersData.records?.[0];
  if (ref) c.header('Set-Cookie', `pf_ref=${ref}; Path=/; Max-Age=86400; SameSite=Lax`);
  if (!user) return render404Page(c, username);

  const userRecordId = user.id;
  const campaignsData = await airtableFetch('CAMPAIGNS', {
    filterByFormula: `AND(FIND('${userRecordId}', ARRAYJOIN({user_id})), {status}='active')`,
  });
  const campaigns: any[] = campaignsData.records || [];

  if (campaigns.length === 0) return renderWaitlistPage(c, user);
  if (campaigns.length === 1) return renderCampaignPageDirect(c, user, campaigns[0], ref);
  return renderBioPageWithCampaigns(c, user, campaigns, ref);
}

function renderWaitlistPage(c: Context, user: any): Response {
  const brandName = user.fields.first_name || user.fields.username || 'This Creator';
  const profileImage =
    user.fields.profile_image ||
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80';
  const username = user.fields.username || '';

  const html = `${htmlHead(`${brandName} | PageFairy`, 'dark')}
<body class="bg-base-100 text-base-content min-h-screen">
  <div class="max-w-md mx-auto min-h-screen flex flex-col"
       x-data="{ email: '', submitted: false, loading: false, error: '' }">

    <div class="flex-grow flex flex-col items-center justify-center p-8 text-center">
      <div class="avatar mb-6">
        <div class="w-24 rounded-full ring ring-base-content/20 ring-offset-base-100 ring-offset-2">
          <img src="${profileImage}" alt="${brandName}">
        </div>
      </div>
      <h1 class="text-3xl font-bold mb-2">${brandName}</h1>
      <p class="text-base-content/60 mb-8">Something special is coming...</p>

      <div class="w-full max-w-sm" x-show="!submitted">
        <p class="text-sm text-base-content/50 mb-4">Get notified when the drop goes live</p>
        <form @submit.prevent="
          loading = true; error = '';
          fetch('/api/waitlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, username: '${username}' })
          })
          .then(r => r.json())
          .then(d => { if (d.success) submitted = true; else error = d.error || 'Try again'; })
          .catch(() => { error = 'Network error. Try again.'; })
          .finally(() => loading = false)
        " class="space-y-3">
          <input
            type="email"
            x-model="email"
            placeholder="Enter your email"
            required
            class="input input-bordered w-full text-center"
          >
          <p x-show="error" x-text="error" class="text-error text-sm"></p>
          <button type="submit" class="btn btn-neutral w-full" :disabled="loading">
            <span x-show="!loading">Notify Me</span>
            <span x-show="loading" class="loading loading-spinner loading-sm"></span>
          </button>
        </form>
      </div>

      <div x-show="submitted" x-cloak class="text-center">
        <div class="w-16 h-16 bg-success/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg class="w-8 h-8 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
          </svg>
        </div>
        <p class="text-lg font-medium">You're on the list!</p>
        <p class="text-base-content/60 text-sm mt-2">We'll email you when it's live.</p>
      </div>
    </div>

    <div class="p-6 text-center">
      <p class="text-xs text-base-content/30">Powered by <a href="https://pagefairy.com" class="hover:text-base-content">PageFairy</a></p>
    </div>
  </div>
</body>
</html>`;

  return c.html(html);
}

function renderBioPageWithCampaigns(c: Context, user: any, campaigns: any[], ref: string = ''): Response {
  const brandName = user.fields.first_name || user.fields.username || 'Shop';
  const profileImage =
    user.fields.profile_image ||
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80';
  const username = user.fields.username || '';

  const campaignCards = campaigns
    .map((camp) => {
      const f = camp.fields;
      const name = f.campaign_name || 'Campaign';
      const price = parseFloat(f.retail_price) || 0;
      const sold = f.current_units || 0;
      const goal = f.goal_units || 10;
      const pct = Math.min(Math.round((sold / goal) * 100), 100);
      const slug = camp.id.slice(-8);
      const image =
        f.image_url ||
        'https://images.unsplash.com/photo-1512496015851-a90fb38ba796?auto=format&fit=crop&w=400&q=80';
      return `
      <a href="/${username}/${slug}${ref ? '?ref=' + ref : ''}" class="card card-compact bg-base-200 hover:bg-base-300 transition overflow-hidden">
        <figure><img src="${image}" class="w-full h-48 object-cover" alt="${name}"></figure>
        <div class="card-body">
          <h3 class="card-title text-base">${name}</h3>
          <div class="flex justify-between items-center">
            <span class="text-xl font-bold">$${price.toFixed(0)}</span>
            <span class="badge badge-ghost">${sold}/${goal} claimed</span>
          </div>
          <progress class="progress progress-neutral w-full mt-1" value="${pct}" max="100"></progress>
        </div>
      </a>`;
    })
    .join('');

  const html = `${htmlHead(`${brandName} | PageFairy`, 'dark')}
<body class="bg-base-100 text-base-content min-h-screen">
  <div class="max-w-md mx-auto pb-8">
    <div class="p-6 text-center">
      <div class="avatar mb-4">
        <div class="w-20 rounded-full ring ring-base-content/20 ring-offset-base-100 ring-offset-2">
          <img src="${profileImage}" alt="${brandName}">
        </div>
      </div>
      <h1 class="text-2xl font-bold">${brandName}</h1>
      <div class="badge badge-success mt-2">LIVE DROPS</div>
    </div>

    <div class="px-4 space-y-4">
      ${campaignCards}
    </div>

    <div class="p-6 text-center mt-8">
      <p class="text-xs text-base-content/30">Powered by <a href="https://pagefairy.com" class="hover:text-base-content">PageFairy</a></p>
    </div>
  </div>
</body>
</html>`;

  return c.html(html);
}

export function renderCampaignPageDirect(c: Context, user: any, campaign: any, referrer: string = ''): Response {
  const f = campaign.fields;
  const brandName = user.fields.first_name || user.fields.username || 'Shop';
  const profileImage =
    user.fields.profile_image ||
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80';
  const productName = f.campaign_name || 'Product';
  const productDesc = f.description || 'Premium quality product.';
  const price = parseFloat(f.retail_price) || 0;
  const sold = f.current_units || 0;
  const goal = f.goal_units || 10;
  const pct = Math.min(Math.round((sold / goal) * 100), 100);
  const remaining = Math.max(goal - sold, 0);
  const image =
    f.image_url ||
    'https://images.unsplash.com/photo-1512496015851-a90fb38ba796?auto=format&fit=crop&w=800&q=80';
  const campaignId = campaign.id;

  const html = `${htmlHead(`${productName} | ${brandName}`, 'light')}
  <meta property="og:title" content="${productName} by ${brandName}">
  <meta property="og:image" content="${image}">
  <meta property="og:description" content="${productDesc}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>body { font-family: 'Inter', system-ui, sans-serif; }</style>
</head>
<body class="bg-base-100 text-base-content min-h-screen" x-data="shopApp()">

  <div class="max-w-md mx-auto min-h-screen flex flex-col shadow-2xl">

    <div class="navbar bg-base-100 shadow-sm sticky top-0 z-40">
      <div class="flex-1 gap-2">
        <div class="avatar">
          <div class="w-8 rounded-full">
            <img src="${profileImage}" alt="${brandName}">
          </div>
        </div>
        <span class="font-semibold text-sm">${brandName}</span>
      </div>
      <div class="badge badge-success badge-sm animate-pulse">LIVE</div>
    </div>

    <figure class="relative w-full aspect-square bg-base-200">
      <img src="${image}" class="w-full h-full object-cover" alt="${productName}">
      ${
        remaining <= 3 && remaining > 0
          ? `<div class="absolute top-4 left-4 badge badge-error">Only ${remaining} left!</div>`
          : ''
      }
    </figure>

    <div class="flex-grow p-6">
      <h1 class="text-2xl font-bold mb-2">${productName}</h1>
      <p class="text-base-content/60 text-sm mb-6">${productDesc}</p>

      <div class="mb-6">
        <div class="flex justify-between text-sm mb-2">
          <span class="font-medium">${sold} of ${goal} claimed</span>
          <span class="text-base-content/50">${pct}%</span>
        </div>
        <progress class="progress progress-neutral w-full" value="${pct}" max="100"></progress>
        ${
          pct >= 100
            ? `<p class="text-success text-sm mt-2 font-medium">Goal reached! Orders shipping soon.</p>`
            : `<p class="text-base-content/40 text-xs mt-2">${remaining} more needed to ship</p>`
        }
      </div>

      <div class="flex gap-4 text-xs text-base-content/50 mb-6">
        <div class="flex items-center gap-1">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
          </svg>
          <span>Secure checkout</span>
        </div>
        <div class="flex items-center gap-1">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path>
          </svg>
          <span>Card held until goal met</span>
        </div>
      </div>
    </div>

    <!-- Checkout Modal -->
    <dialog class="modal" :class="{ 'modal-open': showCheckout }">
      <div class="modal-box">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-lg font-bold">Checkout</h2>
          <button @click="showCheckout = false" class="btn btn-ghost btn-circle btn-sm">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <form @submit.prevent="submitOrder()">
          <div class="space-y-4 mb-6">
            <label class="form-control w-full">
              <div class="label"><span class="label-text">Email</span></div>
              <input type="email" x-model="email" required class="input input-bordered w-full" placeholder="you@example.com">
            </label>
            <label class="form-control w-full">
              <div class="label"><span class="label-text">Name</span></div>
              <input type="text" x-model="name" required class="input input-bordered w-full" placeholder="Your name">
            </label>
          </div>

          <div class="bg-base-200 rounded-xl p-4 mb-6">
            <div class="flex justify-between mb-2">
              <span>${productName}</span>
              <span class="font-bold">$${price.toFixed(2)}</span>
            </div>
            <div class="divider my-1"></div>
            <div class="flex justify-between">
              <span class="font-bold">Total</span>
              <span class="font-bold text-lg">$${price.toFixed(2)}</span>
            </div>
          </div>

          <button type="submit" class="btn btn-neutral w-full" :disabled="loading">
            <span x-show="!loading">Pay $${price.toFixed(2)}</span>
            <span x-show="loading" class="loading loading-spinner"></span>
          </button>
          <p class="text-xs text-base-content/40 text-center mt-4">
            Your card will be authorized but not charged until the campaign reaches its goal.
          </p>
        </form>
      </div>
      <div class="modal-backdrop" @click="showCheckout = false"></div>
    </dialog>

    <!-- Success Screen -->
    <div x-show="orderSuccess" x-cloak class="fixed inset-0 z-50 bg-base-100 flex items-center justify-center">
      <div class="text-center p-8">
        <div class="w-20 h-20 bg-success/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg class="w-10 h-10 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
          </svg>
        </div>
        <h2 class="text-2xl font-bold mb-2">You're in!</h2>
        <p class="text-base-content/60 mb-6">We'll email you when this campaign ships.</p>
        <button @click="location.reload()" class="btn btn-outline">Back to Shop</button>
      </div>
    </div>

    <div class="btm-nav btm-nav-sm sticky bottom-0 bg-base-100 border-t border-base-200 p-4">
      <button @click="showCheckout = true" class="btn btn-neutral btn-block flex justify-between px-6">
        <span>Pre-Order Now</span>
        <span>$${price.toFixed(2)}</span>
      </button>
    </div>

  </div>

  <script>
    function shopApp() {
      return {
        showCheckout: false,
        loading: false,
        orderSuccess: false,
        email: '',
        name: '',
        async submitOrder() {
          this.loading = true;
          try {
            const res = await fetch('/api/checkout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                campaign_id: '${campaignId}',
                email: this.email,
                name: this.name,
                amount: ${Math.round(price * 100)},
                referrer: '${referrer}',
              }),
            });
            const data = await res.json();
            if (data.checkout_url) {
              window.location.href = data.checkout_url;
            } else if (data.success) {
              this.orderSuccess = true;
              this.showCheckout = false;
            } else {
              alert(data.error || 'Something went wrong');
            }
          } catch {
            alert('Network error. Please try again.');
          } finally {
            this.loading = false;
          }
        },
      };
    }
  <\/script>
</body>
</html>`;

  return c.html(html);
}

export function render404Page(c: Context, path: string): Response {
  const html = `${htmlHead('Not Found | PageFairy', 'dark')}
<body class="bg-base-100 text-base-content min-h-screen">
  <div class="hero min-h-screen">
    <div class="hero-content text-center">
      <div>
        <h1 class="text-6xl font-bold mb-4">404</h1>
        <p class="text-base-content/60 mb-6">Page not found: /${path}</p>
        <a href="/" class="btn btn-ghost">Go home</a>
      </div>
    </div>
  </div>
</body>
</html>`;
  return c.html(html, 404);
}
