export const state={user:null,view:'caisse',tab:0,expanded:false,theme:localStorage.getItem('sm-theme')||'light',baskets:[{id:1,name:'Panier 1',customer:null,items:[]}],activeBasket:1,products:[],records:[],query:'',page:1,loading:false,mobileSync:'Connexion…',connectedPhones:0,canPair:false,drawer:null};
export const basket=()=>state.baskets.find(x=>x.id===state.activeBasket)||state.baskets[0];
export const money=n=>new Intl.NumberFormat('fr-DZ',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n)||0);
export const subtotal=()=>basket().items.reduce((s,x)=>s+(Number(x.selling_price)||0)*(Number(x.quantity)||1),0);
export const total=()=>Math.max(0,subtotal()-(Number(basket().discount)||0));